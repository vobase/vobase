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
 * hook (consumed by the WhatsApp adapter) accepts the v2 2-key headers, falls
 * back to the legacy v1 single-key `X-Platform-Signature` while platforms are
 * rolling out, and honors current OR previous-during-grace per the rotation
 * window.
 */

import type { VaultRotation } from '@modules/integrations/service/vault'
import type { WhatsAppTransportConfig } from '@vobase/core'
import { signHmac, signRequest, verifyRequest } from '@vobase/core'

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
      // Two signatures attached to every request during rollout:
      //
      //   v1 (legacy)  — `${METHOD}${path}` only, in `X-Platform-Signature`.
      //                  Read by un-upgraded platforms. Drop after platform
      //                  flips `MANAGED_REQUIRE_SIG_V2=true`.
      //   v2 (new)     — `${METHOD}|${pathWithoutQuery}|${sortedCanonicalQuery}
      //                  |${sha256(body)}` in `X-Vobase-Routine-Sig` /
      //                  `X-Vobase-Rotation-Sig`. Closes SH1 (body unsigned)
      //                  and SH2 (query string unsigned) — tampering with
      //                  either now invalidates the rotation signature.
      //
      // Body is plumbed via a per-request hook on the transport state (see
      // `setPendingBody` below), since the adapter calls `signRequest`
      // immediately before issuing fetch and we have no other channel to the
      // request body in time. Empty when absent.
      const cur = resolve(input.current)
      const { pathOnly, sortedQuery } = splitPathAndQuery(path)
      const bodyDigest = sha256Hex(pendingBody ?? '')
      const v2Payload = `${method.toUpperCase()}|${pathOnly}|${sortedQuery}|${bodyDigest}`
      const v1Payload = `${method.toUpperCase()}${path}`
      const v2 = signRequest({
        body: v2Payload,
        routineSecret: cur.routineSecret,
        rotationKey: cur.rotationKey,
        keyVersion: cur.keyVersion,
      })
      const v1Sig = signHmac(v1Payload, cur.routineSecret)
      // Reset the per-request body buffer so a stale value can't carry over
      // to a follow-up unrelated request that forgot to call setPendingBody.
      pendingBody = null
      return {
        'X-Tenant-Id': input.tenantId,
        'X-Platform-Signature': v1Sig,
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
      // Inbound managed webhooks come from the platform forwarder. Two
      // signatures may be present:
      //   v2 — `X-Vobase-Routine-Sig` + `X-Vobase-Rotation-Sig` + `X-Vobase-Key-Version`
      //   v1 — legacy `X-Platform-Signature` (HMAC-SHA256 of body with the
      //        platform-shared secret, which is the SAME value the tenant
      //        holds as `routineSecret` in the vault during the v1 era).
      // We accept v2 first; if absent we fall back to v1 so a not-yet-upgraded
      // platform can still forward. Once all platforms are on v2 the v1
      // branch can be deleted.
      const cur = resolve(input.current)
      const prev = resolve(input.previous)
      const rawBody = await request.clone().text()

      const routineSig = request.headers.get('X-Vobase-Routine-Sig')
      const rotationSig = request.headers.get('X-Vobase-Rotation-Sig')
      const keyVersionRaw = request.headers.get('X-Vobase-Key-Version')

      if (routineSig && rotationSig && keyVersionRaw) {
        const keyVersion = Number.parseInt(keyVersionRaw, 10)
        if (!Number.isFinite(keyVersion)) return false
        const result = verifyInboundManagedWebhook({
          rawBody,
          routineSignature: routineSig,
          rotationSignature: rotationSig,
          keyVersion,
          current: cur,
          previous: prev,
        })
        return result.ok
      }

      // v1 fallback (legacy single-key header). The platform signs body with
      // its tenant HMAC secret; on the tenant side we hold the same secret
      // as `routineSecret`.
      const legacySig = request.headers.get('X-Platform-Signature')
      if (!legacySig) return false
      const expected = signHmac(rawBody, cur.routineSecret)
      if (constantTimeEqual(legacySig, expected)) return true
      if (prev) {
        const expectedPrev = signHmac(rawBody, prev.routineSecret)
        return constantTimeEqual(legacySig, expectedPrev)
      }
      return false
    },
  }
}

/** Hex string equality with constant time when lengths match. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let acc = 0
  for (let i = 0; i < a.length; i++) acc |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return acc === 0
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

export const __test_splitPathAndQuery = splitPathAndQuery
export const __test_sha256Hex = sha256Hex

/**
 * Verify an inbound webhook signed by the platform forwarder. Accepts the
 * current pair OR the previous pair during the grace window. Used by the
 * generic webhook router when `instance.config.mode === 'managed'`.
 */
export function verifyInboundManagedWebhook(input: {
  rawBody: string
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
    body: input.rawBody,
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
