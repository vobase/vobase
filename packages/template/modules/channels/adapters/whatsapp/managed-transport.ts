/**
 * Managed-mode `WhatsAppTransportConfig` builder.
 *
 * In managed mode, all Graph API calls + media downloads are proxied through
 * the platform's `/api/managed-whatsapp/:platformChannelId/...` surface. The
 * transport rewrites Graph paths to the platform proxy and signs requests with
 * the 2-key HMAC contract (routine + rotation, monotonic keyVersion).
 *
 * Inbound webhooks (forwarded by the platform's per-environment router) carry
 * the same signed-headers contract; the transport's `verifyInboundWebhook`
 * hook (consumed by the WhatsApp adapter) accepts the v2 2-key headers and
 * honors current OR previous-during-grace per the rotation window.
 */

import type { VaultRotation } from '@modules/integrations/service/vault'
import type { WhatsAppTransportConfig } from '@vobase/core'
import { signRequest, verifyRequest } from '@vobase/core'

export type RotationCurrent = VaultRotation['current']
export type RotationPrevious = VaultRotation['previous']

export interface ManagedTransportInput {
  /** Platform-issued channel id (per-tenant + per-env). */
  platformChannelId: string
  /** Origin of the platform service, e.g. `https://platform.voltade.app`. */
  platformBaseUrl: string
  /** Tenant identity headers attached to every proxied request. */
  tenantId: string
  /**
   * Current 2-key pair. Accepts either the rotation object directly or a
   * thunk — the thunk form lets callers defer vault lookup to sign-time so a
   * module-level cache invalidation rotates without re-creating the adapter.
   */
  current: RotationCurrent | (() => RotationCurrent)
  /** Optional previous pair held during rotation grace. */
  previous: RotationPrevious | (() => RotationPrevious)
  /**
   * Optional async pre-step run by `verifyInboundWebhook` BEFORE resolving
   * the current/previous thunks. Lets the factory await a cold vault load
   * (the webhook can race the eager warm-load that runs during adapter
   * construction). Outbound `signRequest` is synchronous by contract, so it
   * doesn't use this hook — outbound first-call latency is acceptable, but
   * an inbound 401 from a transient unloaded cache is not.
   */
  ensureReady?: () => Promise<void>
}

function resolve<T>(v: T | (() => T)): T {
  return typeof v === 'function' ? (v as () => T)() : v
}

/**
 * Build a `WhatsAppTransportConfig` that points at the platform proxy. The
 * adapter uses this instead of calling Meta directly.
 */
export function createManagedTransport(input: ManagedTransportInput): WhatsAppTransportConfig {
  const proxyOrigin = input.platformBaseUrl.replace(/\/$/, '')
  const proxyBase = `${proxyOrigin}/api/managed-whatsapp/${input.platformChannelId}/graph`
  const mediaBase = `${proxyOrigin}/api/managed-whatsapp/${input.platformChannelId}/media-download`

  // Per-transport mutable buffer — the adapter sets this before calling
  // `signRequest` so the body digest can be folded into the v2 payload
  // without re-plumbing the entire transport API.
  let pendingBody: string | null = null

  return {
    baseUrl: proxyBase,
    mediaDownloadUrl: mediaBase,
    signRequest(method: string, path: string): Record<string, string> {
      // v2 contract — `${METHOD}|${pathWithoutQuery}|${sortedCanonicalQuery}
      // |${sha256(body)}` in `X-Vobase-Routine-Sig` / `X-Vobase-Rotation-Sig`.
      // Body is plumbed via a per-request hook on the transport state (see
      // `setPendingBody` below), since the adapter calls `signRequest`
      // immediately before issuing fetch and we have no other channel to the
      // request body in time. Empty when absent.
      const cur = resolve(input.current)
      const { pathOnly, sortedQuery } = splitPathAndQuery(path)
      const bodyDigest = sha256Hex(pendingBody ?? '')
      const v2Payload = `${method.toUpperCase()}|${pathOnly}|${sortedQuery}|${bodyDigest}`
      const v2 = signRequest({
        body: v2Payload,
        routineSecret: cur.routineSecret,
        rotationKey: cur.rotationKey,
        keyVersion: cur.keyVersion,
      })
      // Reset the per-request body buffer so a stale value can't carry over
      // to a follow-up unrelated request that forgot to call setPendingBody.
      pendingBody = null
      return {
        'X-Tenant-Id': input.tenantId,
        'X-Vobase-Routine-Sig': v2.routineSignature,
        'X-Vobase-Rotation-Sig': v2.rotationSignature,
        'X-Vobase-Key-Version': String(v2.keyVersion),
        'X-Vobase-Sig-Version': '2',
        'X-Vobase-Body-Digest': bodyDigest,
      }
    },
    setPendingBody(body) {
      pendingBody = body ?? null
    },
    async verifyInboundWebhook(request: Request): Promise<boolean> {
      // Inbound managed webhooks come from the platform forwarder signed with
      // the v2 contract: `X-Vobase-Routine-Sig` + `X-Vobase-Rotation-Sig` +
      // `X-Vobase-Key-Version`. Accepts current OR previous pair during the
      // rotation grace window.
      if (input.ensureReady) await input.ensureReady()
      const cur = resolve(input.current)
      const prev = resolve(input.previous)
      const rawBody = await request.clone().text()

      const routineSig = request.headers.get('X-Vobase-Routine-Sig')
      const rotationSig = request.headers.get('X-Vobase-Rotation-Sig')
      const keyVersionRaw = request.headers.get('X-Vobase-Key-Version')

      if (!routineSig || !rotationSig || !keyVersionRaw) return false
      const keyVersion = Number.parseInt(keyVersionRaw, 10)
      if (!Number.isFinite(keyVersion)) return false
      // Reconstruct the same canonical v2 payload the platform signed:
      //   `${METHOD}|${pathOnly}|${sortedCanonicalQuery}|${sha256(body)}`.
      // The forwarder signs this string (not the raw body) so a tampered
      // URL or query string invalidates the signature — same contract our
      // outbound transport uses (see `signRequest` above).
      const url = new URL(request.url)
      const { pathOnly, sortedQuery } = splitPathAndQuery(url.pathname + url.search)
      const bodyDigest = sha256Hex(rawBody)
      const v2Payload = `${request.method.toUpperCase()}|${pathOnly}|${sortedQuery}|${bodyDigest}`
      const result = verifyInboundManagedWebhook({
        signedPayload: v2Payload,
        routineSignature: routineSig,
        rotationSignature: rotationSig,
        keyVersion,
        current: cur,
        previous: prev,
      })
      return result.ok
    },
  }
}

function sha256Hex(s: string): string {
  return new Bun.CryptoHasher('sha256').update(s).digest('hex')
}

/**
 * Split a request path into `(pathOnly, sortedCanonicalQuery)` so the v2
 * signature can include a stable representation of the query string.
 *
 * Sort by key, then by value, then percent-decode-encode round trip. The
 * platform side does the exact same canonicalisation before verifying.
 */
function splitPathAndQuery(path: string): { pathOnly: string; sortedQuery: string } {
  const qIdx = path.indexOf('?')
  if (qIdx < 0) return { pathOnly: path, sortedQuery: '' }
  const pathOnly = path.slice(0, qIdx)
  const rawQuery = path.slice(qIdx + 1)
  if (rawQuery.length === 0) return { pathOnly, sortedQuery: '' }
  const params = new URLSearchParams(rawQuery)
  const entries: Array<[string, string]> = []
  for (const [k, v] of params) entries.push([k, v])
  entries.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
  const sorted = new URLSearchParams()
  for (const [k, v] of entries) sorted.append(k, v)
  return { pathOnly, sortedQuery: sorted.toString() }
}

export { sha256Hex, splitPathAndQuery }
// back-compat aliases for existing test imports
export const __test_splitPathAndQuery = splitPathAndQuery
export const __test_sha256Hex = sha256Hex

/**
 * Verify an inbound webhook signed by the platform forwarder. Accepts the
 * current pair OR the previous pair during the grace window. Used by the
 * generic webhook router when `instance.config.mode === 'managed'`.
 */
export function verifyInboundManagedWebhook(input: {
  /**
   * Canonical v2 string the platform signed:
   * `${METHOD}|${pathOnly}|${sortedQuery}|${sha256(body)}`. Tampering with URL,
   * query, or body invalidates the signature.
   */
  signedPayload: string
  routineSignature: string
  rotationSignature: string
  keyVersion: number
  current: VaultRotation['current']
  previous: VaultRotation['previous']
}): { ok: true; nextKeyVersion: number } | { ok: false; reason: string } {
  const accept = [
    {
      routineSecret: input.current.routineSecret,
      rotationKey: input.current.rotationKey,
      keyVersion: input.current.keyVersion,
    },
  ]
  if (input.previous) {
    accept.push({
      routineSecret: input.previous.routineSecret,
      rotationKey: input.previous.rotationKey,
      keyVersion: input.previous.keyVersion,
    })
  }

  const result = verifyRequest({
    body: input.signedPayload,
    routineSignature: input.routineSignature,
    rotationSignature: input.rotationSignature,
    keyVersion: input.keyVersion,
    maxKeyVersionSeen: input.current.keyVersion,
    accept,
  })

  if (!result.ok) {
    return { ok: false, reason: result.reason }
  }
  return { ok: true, nextKeyVersion: result.nextMaxKeyVersionSeen }
}
