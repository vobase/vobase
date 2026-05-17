/**
 * Tenant-side handshake against the platform's managed-channel endpoints.
 *
 * Single owner of the platform-facing IO for managed-channel provisioning —
 * keeps `signRequest`, tenant-id headers, and host validation in one place so
 * handlers + tests don't reimplement it.
 *
 * Per §6 of the platform-tenant decoupling spec, the public surface is
 * parameterized on `kind`: `claim(kind)` / `release(kind)` consult the
 * managed-channels registry to pick the platform path, and `staffLinks.*`
 * exposes the staff-phone-link CRUD that the `notification` tier needs.
 * `handshake.ts` never branches on `kind` itself.
 */
/** @contract platform-tenant-v1 */

import { logger, type SignedRequest, signRequest, validation } from '@vobase/core'
import { z } from 'zod'

import type { ScopedDb } from '~/runtime'
import { sha256Hex, splitPathAndQuery } from '../../channels/adapters/whatsapp/managed-transport'
import { findKind, type ManagedChannelKind } from '../../channels/managed/registry'
import { checkWithin24h } from '../../channels/service/within-24h'
import {
  BODY_SCHEMAS,
  bodyParamsForWire,
  type NotificationTemplateName,
  renderTemplateAsText,
} from './notification-template-payloads'

export interface HandshakeAllocation {
  platformChannelId: string
  wabaId: string
  phoneNumberId: string
  displayPhoneNumber: string
  /**
   * Human label the platform operator assigned to this pool row (e.g.
   * "Vobase Sandbox SG", "Acme Staff Notif"). Tenant uses it as the
   * channel-instance `displayName` so the row in the UI matches what the
   * platform admin chose, instead of a generic per-kind fallback.
   * Optional for back-compat with platforms that pre-date the field.
   */
  label?: string
  routineSecret: string
  rotationKey: string
  keyVersion: number
  routineSecretPrevious: string | null
  rotationKeyPrevious: string | null
  previousValidUntil: string | null
}

const handshakeAllocationSchema = z.object({
  platformChannelId: z.string(),
  wabaId: z.string(),
  phoneNumberId: z.string(),
  displayPhoneNumber: z.string(),
  label: z.string().optional(),
  routineSecret: z.string(),
  rotationKey: z.string(),
  keyVersion: z.number(),
  routineSecretPrevious: z.string().nullable(),
  rotationKeyPrevious: z.string().nullable(),
  previousValidUntil: z.string().nullable(),
})

export class PlatformHandshakeError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'PlatformHandshakeError'
  }
}

/**
 * Reject any `platformBaseUrl` whose hostname doesn't match the env-baked
 * `VITE_PLATFORM_URL`. Defends against a row-supplied `platformBaseUrl`
 * (admin-writable via PATCH /api/channels/instances/:id) being redirected to
 * a different host. Localhost is auto-allowed in non-production for dev.
 */
export function isAllowedPlatformBaseUrl(platformBaseUrl: string): boolean {
  let host: string
  try {
    host = new URL(platformBaseUrl).hostname
  } catch {
    return false
  }
  if (process.env.NODE_ENV !== 'production' && (host === 'localhost' || host === '127.0.0.1')) {
    return true
  }
  const configured = process.env.VITE_PLATFORM_URL ?? ''
  if (!configured) return host === 'localhost' || host === '127.0.0.1'
  try {
    return new URL(configured).hostname === host
  } catch {
    return host === 'localhost' || host === '127.0.0.1'
  }
}

interface HandshakeInput {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  environment: 'production' | 'staging'
  channelInstanceId: string
  /**
   * Channel kind from the managed-channels registry. Determines which
   * platform endpoint to POST to. Defaults to `'sandbox'` so callers that
   * predate US-011's registry threading still work.
   */
  kind?: ManagedChannelKind
}

interface SignedPlatformRequestInput {
  method: 'POST' | 'DELETE' | 'GET'
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  path: string
  /** Body string for POST/DELETE; undefined for GET (signs empty-body digest). */
  body?: string
}

/**
 * Sign + dispatch a request to a platform path on behalf of `tenantId`. One
 * helper for all three verbs — GET signs an empty-body digest; POST/DELETE
 * sign their stringified JSON body. Hostname is validated against the env
 * allowlist before the request leaves the process.
 *
 * Exported so `auth/phone-otp.ts` can reuse the same HMAC v2 signing to POST
 * the staff-phone OTP relay (`/api/whatsapp/otp`) without duplicating the
 * `x-tenant-id` / `x-vobase-*` header surface.
 */
export async function signedPlatformRequest(
  input: SignedPlatformRequestInput,
): Promise<{ res: Response; signed: SignedRequest }> {
  if (!isAllowedPlatformBaseUrl(input.platformBaseUrl)) {
    throw new PlatformHandshakeError(
      `platformBaseUrl '${input.platformBaseUrl}' hostname doesn't match VITE_PLATFORM_URL`,
      null,
      'platform_url_not_allowed',
    )
  }
  const url = `${input.platformBaseUrl.replace(/\/$/, '')}${input.path}`
  const { pathOnly, sortedQuery } = splitPathAndQuery(input.path)
  const bodyForDigest = input.body ?? ''
  const bodyDigest = sha256Hex(bodyForDigest)
  const v2Payload = `${input.method}|${pathOnly}|${sortedQuery}|${bodyDigest}`
  const signed = signRequest({
    body: v2Payload,
    routineSecret: input.tenantHmacSecret,
    rotationKey: input.tenantHmacSecret,
    keyVersion: 1,
  })
  const headers: Record<string, string> = {
    'X-Tenant-Id': input.tenantId,
    'X-Vobase-Routine-Sig': signed.routineSignature,
    'X-Vobase-Rotation-Sig': signed.rotationSignature,
    'X-Vobase-Key-Version': String(signed.keyVersion),
    'X-Vobase-Sig-Version': '2',
    'X-Vobase-Body-Digest': bodyDigest,
  }
  if (input.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(url, {
    method: input.method,
    headers,
    body: input.body,
  })
  return { res, signed }
}

// ─── claim / release (parameterized on kind) ────────────────────────────────

/**
 * Claim a pool slot of the given `kind`. Returns the allocation (platform
 * metadata + key material). Throws `PlatformHandshakeError` on transport,
 * auth, or pool-exhausted errors. The platform path is sourced from the
 * managed-channels registry per kind.
 *
 * v3 wire: the request body is an empty JSON object `{}` — `environment`
 * and `channelInstanceId` were removed from the contract because the
 * platform now keys claims solely on `(tenant_slug, kind)`. The fields are
 * still accepted on `HandshakeInput` (so callers that already plumb them
 * for tenant-local use don't have to drop them), but they are NEVER sent
 * to the platform. Sending them triggers HTTP 410 `legacy_contract_version`.
 */
export async function claim(kind: ManagedChannelKind, input: HandshakeInput): Promise<HandshakeAllocation> {
  const kindSpec = findKind(kind)
  // `input.environment` / `input.channelInstanceId` are intentionally unused
  // on the wire — see v3 contract note above.
  void input.environment
  void input.channelInstanceId
  const body = JSON.stringify({})
  const { res } = await signedPlatformRequest({
    method: 'POST',
    platformBaseUrl: input.platformBaseUrl,
    tenantId: input.tenantId,
    tenantHmacSecret: input.tenantHmacSecret,
    path: kindSpec.claimPath,
    body,
  })

  if (!res.ok) {
    let payload: unknown
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    const code = (payload as { code?: string } | null)?.code
    throw new PlatformHandshakeError(`platform ${kind} claim failed (${res.status})`, res.status, code)
  }

  return handshakeAllocationSchema.parse(await res.json())
}

/**
 * Tenant-initiated release of a managed claim of the given `kind`. Mirrors
 * `claim`'s signing path.
 */
export async function release(
  kind: ManagedChannelKind,
  input: {
    platformBaseUrl: string
    tenantId: string
    tenantHmacSecret: string
    /**
     * Kept on the input for caller compatibility; not sent on the wire under
     * v3 (the platform releases solely by `(tenant_slug, kind)`).
     */
    environment?: 'production' | 'staging'
  },
): Promise<{ released: boolean }> {
  const kindSpec = findKind(kind)
  void input.environment
  const body = JSON.stringify({})
  const { res } = await signedPlatformRequest({
    method: 'POST',
    platformBaseUrl: input.platformBaseUrl,
    tenantId: input.tenantId,
    tenantHmacSecret: input.tenantHmacSecret,
    path: kindSpec.releasePath,
    body,
  })
  if (!res.ok) {
    throw new PlatformHandshakeError(`platform ${kind} release failed (${res.status})`, res.status)
  }
  return (await res.json()) as { released: boolean }
}

// ─── Legacy aliases (kept until callers migrate) ────────────────────────────

/**
 * Call the platform's sandbox claim endpoint. Thin wrapper over `claim('sandbox', …)`
 * preserved so existing callers (e.g. `claimAndBootstrap`) don't have to flip
 * to the parameterized form in the same change that adds the second kind.
 */
export async function handshakeWithPlatform(input: HandshakeInput): Promise<HandshakeAllocation> {
  return claim(input.kind ?? 'sandbox', input)
}

/** Sandbox-tier release. Thin wrapper over `release('sandbox', …)`. */
export async function releaseWithPlatform(input: {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  environment: 'production' | 'staging'
}): Promise<{ released: boolean }> {
  return release('sandbox', input)
}

// ─── Staff-link CRUD (notification tier) ────────────────────────────────────

/** Convert a `+E164` to a wa_id (`E164` with the leading `+` stripped). */
function toWaId(staffPhoneE164: string): string {
  return staffPhoneE164.startsWith('+') ? staffPhoneE164.slice(1) : staffPhoneE164
}

interface StaffLinkUpsertInput {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  environment: 'production' | 'staging'
  channelInstanceId: string
  staffUserId: string
  /** E.164 with leading `+`. Platform stores the wa_id form (without `+`). */
  staffPhoneE164: string
}

interface StaffLinkDeleteInput {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  environment: 'production' | 'staging'
  /** E.164 with leading `+`. */
  staffPhoneE164: string
}

interface StaffLinkListInput {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  channelInstanceId?: string
}

export interface StaffLinkRow {
  staffUserId: string
  staffPhoneE164: string
  channelInstanceId: string
  linkedAt: string
}

const staffLinkRowSchema = z.object({
  staffUserId: z.string(),
  staffPhoneE164: z.string(),
  channelInstanceId: z.string(),
  linkedAt: z.string(),
})

/**
 * Staff-phone-link CRUD against the platform. The platform uses the link to
 * route inbound messages from the staff WA number back to the tenant when
 * the notification-tier pool slot is in use.
 */
export const staffLinks = {
  /**
   * Register or update a staff-phone link. Idempotent on
   * `(tenantId, channelInstanceId, staffUserId)`.
   */
  async upsert(input: StaffLinkUpsertInput): Promise<{ linked: true; staffPhoneE164: string }> {
    const body = JSON.stringify({
      environment: input.environment,
      channelInstanceId: input.channelInstanceId,
      staffUserId: input.staffUserId,
      staffPhoneE164: toWaId(input.staffPhoneE164),
    })
    const { res } = await signedPlatformRequest({
      method: 'POST',
      platformBaseUrl: input.platformBaseUrl,
      tenantId: input.tenantId,
      tenantHmacSecret: input.tenantHmacSecret,
      path: '/api/managed-whatsapp/staff-links',
      body,
    })
    if (!res.ok) {
      let payload: unknown
      try {
        payload = await res.json()
      } catch {
        payload = null
      }
      const code = (payload as { code?: string } | null)?.code
      throw new PlatformHandshakeError(`platform staff-link upsert failed (${res.status})`, res.status, code)
    }
    return (await res.json()) as { linked: true; staffPhoneE164: string }
  },

  /**
   * Delete a staff-link by phone. Used when the staff member clears their
   * personal WhatsApp number in settings.
   */
  async delete(input: StaffLinkDeleteInput): Promise<{ removed: boolean }> {
    const body = JSON.stringify({
      environment: input.environment,
      staffPhoneE164: toWaId(input.staffPhoneE164),
    })
    const { res } = await signedPlatformRequest({
      method: 'DELETE',
      platformBaseUrl: input.platformBaseUrl,
      tenantId: input.tenantId,
      tenantHmacSecret: input.tenantHmacSecret,
      path: '/api/managed-whatsapp/staff-links',
      body,
    })
    if (!res.ok) {
      throw new PlatformHandshakeError(`platform staff-link delete failed (${res.status})`, res.status)
    }
    return (await res.json()) as { removed: boolean }
  },

  /**
   * List staff-links registered for this tenant, optionally filtered to a
   * single `channelInstanceId`.
   */
  async list(input: StaffLinkListInput): Promise<StaffLinkRow[]> {
    const params = new URLSearchParams()
    if (input.channelInstanceId) params.set('channelInstanceId', input.channelInstanceId)
    const query = params.toString()
    const path = `/api/managed-whatsapp/staff-links${query ? `?${query}` : ''}`
    const { res } = await signedPlatformRequest({
      method: 'GET',
      platformBaseUrl: input.platformBaseUrl,
      tenantId: input.tenantId,
      tenantHmacSecret: input.tenantHmacSecret,
      path,
    })
    if (!res.ok) {
      throw new PlatformHandshakeError(`platform staff-link list failed (${res.status})`, res.status)
    }
    const data = (await res.json()) as { links: unknown }
    return z.array(staffLinkRowSchema).parse(data.links)
  },
}

// ─── Webhook + availability helpers (unchanged from Slice 2) ────────────────

/**
 * Register a webhook URL + verify token with the platform for the calling
 * tenant. The platform runs the provider's challenge protocol against the URL
 * before persisting; on success, future inbound forwards target the supplied
 * URL verbatim.
 *
 * Idempotent: re-calling with the same `(tenantSlug, provider, webhookUrl)`
 * triple re-runs the challenge and refreshes `lastVerifiedAt`. Re-calling
 * with a different URL replaces it.
 *
 * v3 wire: `environment` and `channelInstanceId` were removed from the body
 * (the platform now keys endpoints on `(tenant_slug, provider, webhook_url)`
 * and mints its own `endpointId` to identify the row). Sending either field
 * triggers HTTP 410 `legacy_contract_version`. The response now carries
 * `endpointId` — a 12-char platform-side nanoid that the tenant persists in
 * `channel_instances.config.endpointId` so the `/link <endpointId>` QR
 * encoding stays stable across re-verifies.
 *
 * `label` is optional and human-readable — surfaced in the platform admin UI.
 */
export async function registerWebhookWithPlatform(input: {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  provider: string
  webhookUrl: string
  verifyToken: string
  /** Optional human label persisted on the platform endpoint row. */
  label?: string
}): Promise<{ ok: true; registeredAt: string; endpointId: string }> {
  const body = JSON.stringify({
    provider: input.provider,
    webhookUrl: input.webhookUrl,
    verifyToken: input.verifyToken,
    ...(input.label !== undefined ? { label: input.label } : {}),
  })
  const { res } = await signedPlatformRequest({
    method: 'POST',
    platformBaseUrl: input.platformBaseUrl,
    tenantId: input.tenantId,
    tenantHmacSecret: input.tenantHmacSecret,
    path: '/api/provisioning/webhook-endpoints/register',
    body,
  })
  if (!res.ok) {
    let payload: unknown
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    const reason = (payload as { reason?: string } | null)?.reason
    throw new PlatformHandshakeError(
      `platform webhook registration failed (${res.status}${reason ? `: ${reason}` : ''})`,
      res.status,
      reason,
    )
  }
  const parsed = (await res.json()) as { endpointId?: string; registeredAt?: string }
  if (typeof parsed.endpointId !== 'string' || parsed.endpointId.length === 0) {
    throw new PlatformHandshakeError(
      'platform webhook registration response missing endpointId',
      res.status,
      'missing_endpoint_id',
    )
  }
  return {
    ok: true,
    registeredAt: parsed.registeredAt ?? new Date().toISOString(),
    endpointId: parsed.endpointId,
  }
}

// ─── Notification send (US-024: within-24h branching + meta_131047 fallback) ─

/**
 * Wire-route discriminator returned by `sendNotificationTemplate`.
 *
 * - `'template'` — sent via the notification-tier template endpoint (default
 *   when outside the 24h customer service window, or when free-form is
 *   unavailable).
 * - `'freeform'` — sent via the free-form endpoint because the staff phone
 *   exchanged an inbound WA message within the 24h window.
 * - `'freeform_fallback_template'` — free-form was attempted and rejected
 *   with Meta error 131047 (recipient outside the 24h window from Meta's
 *   point of view, despite our local `checkWithin24h` returning `true`),
 *   then retried successfully on the template path.
 */
export type WireRoute = 'freeform' | 'template' | 'freeform_fallback_template'

export interface SendNotificationTemplateResult {
  ok: true
  messageId: string | null
  wireRoute: WireRoute
}

/** Cost estimate in USD per wire route. `freeform` is $0 (within-window reply). */
export const COST_ESTIMATE_USD: Record<WireRoute, number> = {
  freeform: 0,
  template: 0.05,
  freeform_fallback_template: 0.05,
}

/** Full platform URL prefix used to reconstruct the button URL for free-form sends. */
const PLATFORM_FULL_URL_PREFIX = 'https://platform.voltade.app/'

interface SendNotificationTemplateInput {
  /** Scoped Drizzle handle — used for the within-24h lookup against `infra.channels_log`. */
  db: ScopedDb
  organizationId: string
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  staffPhoneE164: string
  templateName: NotificationTemplateName
  bodyParams: unknown
  /**
   * Path suffix appended to `https://platform.voltade.app/` to form the full
   * button URL. The template path forwards the suffix verbatim to the platform;
   * the free-form path reconstructs the full URL for the rendered text body.
   */
  buttonUrlSuffix: string
}

/** Validated input with `parsedBody` already extracted from `BODY_SCHEMAS`. */
interface ValidatedSendInput extends SendNotificationTemplateInput {
  parsedBody: unknown
}

/**
 * Send a typed notification template to a staff phone, choosing between the
 * platform's notification-tier template endpoint and the free-form endpoint
 * based on whether the staff phone has an active 24h WhatsApp customer
 * service window.
 *
 * Routing decision (US-024):
 *   1. `checkWithin24h(db, staffPhoneE164, organizationId)` — queries
 *      `infra.channels_log` for a recent inbound from the staff phone (23h50m
 *      safety margin against clock skew).
 *   2. If within-24h is `true`, the message ships as free-form text rendered
 *      from the template via `renderTemplateAsText`. Meta charges $0 for
 *      free-form replies inside the customer service window.
 *   3. If the platform rejects the free-form send with HTTP 4xx + body
 *      `{code:'meta_131047'}` (recipient outside the window from Meta's PoV,
 *      despite our local check), we fall back to the template path using a
 *      distinct idempotency key so the platform's dedup map does not suppress
 *      the retry. Returns `wireRoute: 'freeform_fallback_template'`.
 *   4. Other 4xx/5xx from the freeform endpoint throw `PlatformHandshakeError`
 *      WITHOUT fallback — they represent different failure modes (auth, network,
 *      platform 5xx) that a template retry would not fix.
 *   5. If within-24h is `false`, the template path is used directly.
 *
 * `bodyParams` is validated against `BODY_SCHEMAS[templateName]` before any
 * network call; a mismatch throws `VobaseError(VALIDATION)` regardless of
 * which wire route would have been chosen.
 */
export async function sendNotificationTemplate(
  input: SendNotificationTemplateInput,
): Promise<SendNotificationTemplateResult> {
  const parseResult = BODY_SCHEMAS[input.templateName].safeParse(input.bodyParams)
  if (!parseResult.success) {
    throw validation(
      { templateName: input.templateName, issues: parseResult.error.issues },
      `sendNotificationTemplate: invalid bodyParams for template '${input.templateName}'`,
    )
  }
  const validated: ValidatedSendInput = { ...input, parsedBody: parseResult.data }

  const within24h = await checkWithin24h(input.db, input.staffPhoneE164, input.organizationId)
  if (!within24h) {
    return sendViaTemplate(validated)
  }

  // Within-24h path: generate a single caller key so the freeform + template-fallback
  // attempts share a stable prefix but use distinct idempotency keys against
  // the platform's 5-minute dedup window.
  const callerKey = crypto.randomUUID()
  const freeformKey = `${callerKey}:freeform`
  const templateKey = `${callerKey}:template`
  try {
    return await sendViaFreeform(validated, freeformKey)
  } catch (err) {
    if (err instanceof PlatformHandshakeError && err.code === 'meta_131047') {
      logger.info(
        {
          staffPhoneE164: input.staffPhoneE164,
          templateName: input.templateName,
          freeformKey,
          templateKey,
        },
        '[handshake] freeform rejected with 131047, falling back to template',
      )
      const templateResult = await sendViaTemplate(validated, templateKey)
      return { ...templateResult, wireRoute: 'freeform_fallback_template' }
    }
    throw err
  }
}

/**
 * Template path — POST to the platform's `/api/managed-whatsapp/notification/send`
 * with the validated typed body mapped to positional `bodyParams`.
 *
 * Used directly when outside the 24h window, and as the fallback when the
 * free-form attempt is rejected with Meta error 131047.
 */
async function sendViaTemplate(
  input: ValidatedSendInput,
  idempotencyKey?: string,
): Promise<SendNotificationTemplateResult> {
  const positionalParams = bodyParamsForWire(input.templateName, input.parsedBody)
  const wireBody = JSON.stringify({
    staffPhoneE164: input.staffPhoneE164,
    templateName: input.templateName,
    bodyParams: positionalParams,
    buttonUrlSuffix: input.buttonUrlSuffix,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  })
  const { res } = await signedPlatformRequest({
    method: 'POST',
    platformBaseUrl: input.platformBaseUrl,
    tenantId: input.tenantId,
    tenantHmacSecret: input.tenantHmacSecret,
    path: '/api/managed-whatsapp/notification/send',
    body: wireBody,
  })
  if (!res.ok) {
    let payload: unknown
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    const code = (payload as { code?: string } | null)?.code
    throw new PlatformHandshakeError(
      `platform notification send failed (${res.status}${code ? `: ${code}` : ''})`,
      res.status,
      code ?? undefined,
    )
  }
  const parsed = (await res.json()) as { messageId?: string | null }
  return { ok: true, messageId: parsed.messageId ?? null, wireRoute: 'template' }
}

/**
 * Free-form path — POST to `/api/whatsapp/freeform` with a pre-rendered text
 * body and an idempotency key. The platform endpoint proxies to Meta Cloud
 * API's free-form send; Meta returns 131047 when the recipient is outside the
 * 24h customer service window from Meta's PoV. Other 4xx/5xx bubble up as
 * `PlatformHandshakeError` — no fallback for those failure modes.
 */
async function sendViaFreeform(
  input: ValidatedSendInput,
  idempotencyKey: string,
): Promise<SendNotificationTemplateResult> {
  const fullButtonUrl = `${PLATFORM_FULL_URL_PREFIX}${input.buttonUrlSuffix}`
  const bodyText = renderTemplateAsText(input.templateName, input.parsedBody, fullButtonUrl)
  const wireBody = JSON.stringify({
    staffPhoneE164: input.staffPhoneE164,
    bodyText,
    idempotencyKey,
  })
  const { res } = await signedPlatformRequest({
    method: 'POST',
    platformBaseUrl: input.platformBaseUrl,
    tenantId: input.tenantId,
    tenantHmacSecret: input.tenantHmacSecret,
    path: '/api/whatsapp/freeform',
    body: wireBody,
  })
  if (!res.ok) {
    let payload: unknown
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    const code = (payload as { code?: string } | null)?.code
    throw new PlatformHandshakeError(
      `platform freeform send failed (${res.status}${code ? `: ${code}` : ''})`,
      res.status,
      code ?? undefined,
    )
  }
  const parsed = (await res.json()) as { messageId?: string | null }
  return { ok: true, messageId: parsed.messageId ?? null, wireRoute: 'freeform' }
}

export interface WebhookEndpointStatus {
  id: string
  channelInstanceId: string
  provider: string
  webhookUrl: string
  environmentLabel: string | null
  lastVerifiedAt: string | null
  lastVerifyStatus: 'ok' | 'failed' | 'pending' | null
  lastVerifyError: string | null
  registeredAt: string
}

/**
 * Read the platform's sandbox pool availability count. Used by the tenant
 * UI to gray out the "claim sandbox" button when no pool slots are free,
 * sparing the user a pointless click that would 503.
 *
 * Signed with the v2 2-key contract (same canonical payload as outbound
 * transport GET requests).
 */
export async function fetchSandboxAvailability(input: {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
}): Promise<{ sandboxPoolAvailable: number; schemaVersion: string }> {
  const data = await fetchPoolHealth(input)
  if (typeof data.sandboxPoolAvailable !== 'number') {
    throw new PlatformHandshakeError(
      'platform rejected tenant HMAC signature on /health (tenant unknown, inactive, or secret drift)',
      null,
      'platform_unauthenticated',
    )
  }
  return {
    sandboxPoolAvailable: data.sandboxPoolAvailable,
    schemaVersion: data.schemaVersion ?? '',
  }
}

/**
 * Read the platform's notification-tier pool availability. Same `/health`
 * endpoint as `fetchSandboxAvailability` — `/health` already returns both
 * counters; this helper picks the notification one. Lets the UI gate the
 * "Claim notification channel" button symmetrically to sandbox.
 */
export async function fetchNotificationAvailability(input: {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
}): Promise<{ notificationPoolAvailable: number; schemaVersion: string }> {
  const data = await fetchPoolHealth(input)
  if (typeof data.notificationPoolAvailable !== 'number') {
    throw new PlatformHandshakeError(
      'platform rejected tenant HMAC signature on /health (tenant unknown, inactive, or secret drift)',
      null,
      'platform_unauthenticated',
    )
  }
  return {
    notificationPoolAvailable: data.notificationPoolAvailable,
    schemaVersion: data.schemaVersion ?? '',
  }
}

/**
 * Shared `/health` fetcher. Platform's `/health` strips data fields
 * (returns bare `{ok: true}`) when tenant HMAC fails to verify, so the
 * per-kind callers above translate "field missing" into a structured
 * `platform_unauthenticated` error instead of masquerading as pool
 * exhaustion. Common causes: tenant row missing on the platform,
 * `tenant.status !== 'active'`, or HMAC secret drift.
 */
async function fetchPoolHealth(input: {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
}): Promise<{
  ok: boolean
  sandboxPoolAvailable?: number
  notificationPoolAvailable?: number
  schemaVersion?: string
}> {
  const { res } = await signedPlatformRequest({
    method: 'GET',
    platformBaseUrl: input.platformBaseUrl,
    tenantId: input.tenantId,
    tenantHmacSecret: input.tenantHmacSecret,
    path: '/api/managed-whatsapp/health',
  })
  if (!res.ok) {
    throw new PlatformHandshakeError(`platform health fetch failed (${res.status})`, res.status)
  }
  return (await res.json()) as {
    ok: boolean
    sandboxPoolAvailable?: number
    notificationPoolAvailable?: number
    schemaVersion?: string
  }
}

/** Read this tenant's registered webhook endpoints from the platform. */
export async function fetchWebhookEndpointStatus(input: {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  provider?: string
  channelInstanceId?: string
}): Promise<WebhookEndpointStatus[]> {
  const params = new URLSearchParams()
  if (input.provider) params.set('provider', input.provider)
  if (input.channelInstanceId) params.set('channelInstanceId', input.channelInstanceId)
  const query = params.toString()
  const path = `/api/provisioning/webhook-endpoints/status${query ? `?${query}` : ''}`
  const { res } = await signedPlatformRequest({
    method: 'GET',
    platformBaseUrl: input.platformBaseUrl,
    tenantId: input.tenantId,
    tenantHmacSecret: input.tenantHmacSecret,
    path,
  })
  if (!res.ok) {
    throw new PlatformHandshakeError(`platform status fetch failed (${res.status})`, res.status)
  }
  const data = (await res.json()) as { endpoints: WebhookEndpointStatus[] }
  return data.endpoints
}
