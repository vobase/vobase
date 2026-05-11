/**
 * Tenant-side handshake against the platform's `/sandbox/create` endpoint.
 *
 * Single owner of the platform-facing IO for managed-channel provisioning —
 * keeps `signRequest`, tenant-id headers, and host validation in one place so
 * handlers + tests don't reimplement it.
 */
/** @contract platform-tenant-v1 */

import { type SignedRequest, signRequest } from '@vobase/core'

import { sha256Hex, splitPathAndQuery } from '../../channels/adapters/whatsapp/managed-transport'
import { findKind } from '../../channels/managed/registry'

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
   * predate US-011's registry threading still work — the only kind that
   * exists today.
   */
  kind?: 'sandbox'
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
 * Call the platform's `POST /api/managed-whatsapp/sandbox/create` over the
 * 2-key signed contract. Returns the sandbox-pool allocation. Throws
 * `PlatformHandshakeError` on transport / auth / pool-exhausted errors.
 */
export async function handshakeWithPlatform(input: HandshakeInput): Promise<HandshakeAllocation> {
  const body = JSON.stringify({
    environment: input.environment,
    channelInstanceId: input.channelInstanceId,
  })
  // Registry consult — sandbox is the only kind today, but Slice 3's
  // `notification` kind will register a different `claimPath` so this file
  // never grows a switch statement on `kind`.
  const kindSpec = findKind(input.kind ?? 'sandbox')
  const { res } = await signedPlatformPost(kindSpec.claimPath, body, input)

  if (!res.ok) {
    let payload: unknown
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    const code = (payload as { code?: string } | null)?.code
    throw new PlatformHandshakeError(`platform handshake failed (${res.status})`, res.status, code)
  }

  const data = (await res.json()) as HandshakeAllocation
  return data
}

/** Tenant-initiated release of own managed link. Mirrors handshake's signing path. */
export async function releaseWithPlatform(input: {
  platformBaseUrl: string
  tenantId: string
  tenantHmacSecret: string
  environment: 'production' | 'staging'
}): Promise<{ released: boolean }> {
  const body = JSON.stringify({ environment: input.environment })
  const { res } = await signedPlatformPost('/api/managed-whatsapp/tenant/release', body, input)
  if (!res.ok) {
    throw new PlatformHandshakeError(`platform release failed (${res.status})`, res.status)
  }
  return (await res.json()) as { released: boolean }
}

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
  if (!isAllowedPlatformBaseUrl(input.platformBaseUrl)) {
    throw new PlatformHandshakeError(
      `platformBaseUrl '${input.platformBaseUrl}' hostname doesn't match VITE_PLATFORM_URL`,
      null,
      'platform_url_not_allowed',
    )
  }
  const path = '/api/managed-whatsapp/health'
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
  // GET requests are signed via the same v2 path; signedPlatformPost only
  // does POST, so we sign manually here matching the same canonical payload.
  if (!isAllowedPlatformBaseUrl(input.platformBaseUrl)) {
    throw new PlatformHandshakeError(
      `platformBaseUrl '${input.platformBaseUrl}' hostname doesn't match VITE_PLATFORM_URL`,
      null,
      'platform_url_not_allowed',
    )
  }
  const path = `/api/provisioning/webhook-endpoints/status${query ? `?${query}` : ''}`
  const url = `${input.platformBaseUrl.replace(/\/$/, '')}${path}`
  const { pathOnly, sortedQuery } = splitPathAndQuery(path)
  const bodyDigest = sha256Hex('') // empty body for GET
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
  if (!res.ok) {
    throw new PlatformHandshakeError(`platform status fetch failed (${res.status})`, res.status)
  }
  const data = (await res.json()) as { endpoints: WebhookEndpointStatus[] }
  return data.endpoints
}
