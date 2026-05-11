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

import { type SignedRequest, signRequest } from '@vobase/core'
import { z } from 'zod'

import { sha256Hex, splitPathAndQuery } from '../../channels/adapters/whatsapp/managed-transport'
import { findKind, type ManagedChannelKind } from '../../channels/managed/registry'

export interface HandshakeAllocation {
  platformChannelId: string
  wabaId: string
  phoneNumberId: string
  displayPhoneNumber: string
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

interface SignedPlatformPostInput {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
}

/**
 * Sign + POST a JSON body to a platform path on behalf of `tenantId`. Signs
 * with the v2 2-key contract. Hostname is validated against the env allowlist
 * before the request leaves the process.
 */
async function signedPlatformPost(
  path: string,
  body: string,
  input: SignedPlatformPostInput,
): Promise<{ res: Response; signed: SignedRequest }> {
  if (!isAllowedPlatformBaseUrl(input.platformBaseUrl)) {
    throw new PlatformHandshakeError(
      `platformBaseUrl '${input.platformBaseUrl}' hostname doesn't match VITE_PLATFORM_URL`,
      null,
      'platform_url_not_allowed',
    )
  }

  const url = `${input.platformBaseUrl.replace(/\/$/, '')}${path}`
  const { pathOnly, sortedQuery } = splitPathAndQuery(path)
  const bodyDigest = sha256Hex(body)
  const v2Payload = `POST|${pathOnly}|${sortedQuery}|${bodyDigest}`
  const signed = signRequest({
    body: v2Payload,
    routineSecret: input.tenantHmacSecret,
    rotationKey: input.tenantHmacSecret,
    keyVersion: 1,
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': input.tenantId,
      'X-Vobase-Routine-Sig': signed.routineSignature,
      'X-Vobase-Rotation-Sig': signed.rotationSignature,
      'X-Vobase-Key-Version': String(signed.keyVersion),
      'X-Vobase-Sig-Version': '2',
      'X-Vobase-Body-Digest': bodyDigest,
    },
    body,
  })
  return { res, signed }
}

/**
 * Sign + DELETE a JSON body to a platform path on behalf of `tenantId`.
 * `signedPlatformPost` only does POST; staff-link delete needs DELETE with
 * the same v2 canonical payload shape.
 */
async function signedPlatformDelete(
  path: string,
  body: string,
  input: SignedPlatformPostInput,
): Promise<{ res: Response; signed: SignedRequest }> {
  if (!isAllowedPlatformBaseUrl(input.platformBaseUrl)) {
    throw new PlatformHandshakeError(
      `platformBaseUrl '${input.platformBaseUrl}' hostname doesn't match VITE_PLATFORM_URL`,
      null,
      'platform_url_not_allowed',
    )
  }
  const url = `${input.platformBaseUrl.replace(/\/$/, '')}${path}`
  const { pathOnly, sortedQuery } = splitPathAndQuery(path)
  const bodyDigest = sha256Hex(body)
  const v2Payload = `DELETE|${pathOnly}|${sortedQuery}|${bodyDigest}`
  const signed = signRequest({
    body: v2Payload,
    routineSecret: input.tenantHmacSecret,
    rotationKey: input.tenantHmacSecret,
    keyVersion: 1,
  })
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': input.tenantId,
      'X-Vobase-Routine-Sig': signed.routineSignature,
      'X-Vobase-Rotation-Sig': signed.rotationSignature,
      'X-Vobase-Key-Version': String(signed.keyVersion),
      'X-Vobase-Sig-Version': '2',
      'X-Vobase-Body-Digest': bodyDigest,
    },
    body,
  })
  return { res, signed }
}

/**
 * Sign + GET a platform path on behalf of `tenantId`. Same v2 canonical
 * payload shape as POST/DELETE with empty body digest.
 */
async function signedPlatformGet(
  path: string,
  input: SignedPlatformPostInput,
): Promise<{ res: Response; signed: SignedRequest }> {
  if (!isAllowedPlatformBaseUrl(input.platformBaseUrl)) {
    throw new PlatformHandshakeError(
      `platformBaseUrl '${input.platformBaseUrl}' hostname doesn't match VITE_PLATFORM_URL`,
      null,
      'platform_url_not_allowed',
    )
  }
  const url = `${input.platformBaseUrl.replace(/\/$/, '')}${path}`
  const { pathOnly, sortedQuery } = splitPathAndQuery(path)
  const bodyDigest = sha256Hex('')
  const v2Payload = `GET|${pathOnly}|${sortedQuery}|${bodyDigest}`
  const signed = signRequest({
    body: v2Payload,
    routineSecret: input.tenantHmacSecret,
    rotationKey: input.tenantHmacSecret,
    keyVersion: 1,
  })
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Tenant-Id': input.tenantId,
      'X-Vobase-Routine-Sig': signed.routineSignature,
      'X-Vobase-Rotation-Sig': signed.rotationSignature,
      'X-Vobase-Key-Version': String(signed.keyVersion),
      'X-Vobase-Sig-Version': '2',
      'X-Vobase-Body-Digest': bodyDigest,
    },
  })
  return { res, signed }
}

// ─── claim / release (parameterized on kind) ────────────────────────────────

/**
 * Claim a pool slot of the given `kind`. Returns the allocation (platform
 * metadata + key material). Throws `PlatformHandshakeError` on transport,
 * auth, or pool-exhausted errors. The platform path is sourced from the
 * managed-channels registry per kind.
 */
export async function claim(kind: ManagedChannelKind, input: HandshakeInput): Promise<HandshakeAllocation> {
  const kindSpec = findKind(kind)
  const body = JSON.stringify({
    environment: input.environment,
    channelInstanceId: input.channelInstanceId,
  })
  const { res } = await signedPlatformPost(kindSpec.claimPath, body, input)

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
    environment: 'production' | 'staging'
  },
): Promise<{ released: boolean }> {
  const kindSpec = findKind(kind)
  const body = JSON.stringify({ environment: input.environment })
  const { res } = await signedPlatformPost(kindSpec.releasePath, body, input)
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
    const { res } = await signedPlatformPost('/api/managed-whatsapp/staff-links', body, input)
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
    const { res } = await signedPlatformDelete('/api/managed-whatsapp/staff-links', body, input)
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
    const { res } = await signedPlatformGet(path, input)
    if (!res.ok) {
      throw new PlatformHandshakeError(`platform staff-link list failed (${res.status})`, res.status)
    }
    const data = (await res.json()) as { links: unknown }
    return z.array(staffLinkRowSchema).parse(data.links)
  },
}

// ─── Webhook + availability helpers (unchanged from Slice 2) ────────────────

/**
 * Register a webhook URL + verify token with the platform for a given
 * `(channelInstanceId, provider)`. The platform runs the provider's
 * challenge protocol against the URL before persisting; on success, future
 * inbound forwards target the supplied URL verbatim.
 *
 * Idempotent: re-calling with the same payload re-runs the challenge and
 * refreshes `lastVerifiedAt`. Re-calling with a different URL replaces it.
 *
 * `environment` is a free-text indicative label here — the platform stores
 * it for human readability but doesn't use it for routing (channelInstanceId
 * is the routing key).
 */
export async function registerWebhookWithPlatform(input: {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  environment: string
  provider: string
  channelInstanceId: string
  webhookUrl: string
  verifyToken: string
}): Promise<{ ok: true; registeredAt: string }> {
  const body = JSON.stringify({
    environment: input.environment,
    provider: input.provider,
    channelInstanceId: input.channelInstanceId,
    webhookUrl: input.webhookUrl,
    verifyToken: input.verifyToken,
  })
  const { res } = await signedPlatformPost('/api/provisioning/webhook-endpoints/register', body, input)
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
  return (await res.json()) as { ok: true; registeredAt: string }
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
  const { res } = await signedPlatformGet('/api/managed-whatsapp/health', input)
  if (!res.ok) {
    throw new PlatformHandshakeError(`platform health fetch failed (${res.status})`, res.status)
  }
  const data = (await res.json()) as {
    ok: boolean
    sandboxPoolAvailable?: number
    schemaVersion?: string
  }
  if (typeof data.sandboxPoolAvailable !== 'number') {
    // Platform's `/health` strips data fields (returns bare `{ok: true}`) when
    // tenant HMAC fails to verify. We surface that as an explicit error so the
    // dialog shows "auth failed" instead of masquerading as pool exhaustion.
    // Common causes: tenant row missing on the platform, tenant.status !==
    // 'active', or HMAC secret drift between tenant vault and platform DB.
    throw new PlatformHandshakeError(
      'platform rejected tenant HMAC signature on /health (tenant unknown, inactive, or secret drift)',
      res.status,
      'platform_unauthenticated',
    )
  }
  return {
    sandboxPoolAvailable: data.sandboxPoolAvailable,
    schemaVersion: data.schemaVersion ?? '',
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
  const { res } = await signedPlatformGet(path, input)
  if (!res.ok) {
    throw new PlatformHandshakeError(`platform status fetch failed (${res.status})`, res.status)
  }
  const data = (await res.json()) as { endpoints: WebhookEndpointStatus[] }
  return data.endpoints
}
