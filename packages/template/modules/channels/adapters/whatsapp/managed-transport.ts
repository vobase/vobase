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

  return {
    baseUrl: proxyBase,
    mediaDownloadUrl: mediaBase,
    signRequest(method: string, path: string): Record<string, string> {
      // Sign `method+path` per the platform's tenant→platform contract. The
      // 2-key signed slate uses the request line itself; the body is empty
      // for GETs and JSON for POSTs/PUTs (the api.ts caller already sets
      // Content-Type for non-binary bodies).
      const cur = resolve(input.current)
      const payload = `${method.toUpperCase()}${path}`
      const signed = signRequest({
        body: payload,
        routineSecret: cur.routineSecret,
        rotationKey: cur.rotationKey,
        keyVersion: cur.keyVersion,
      })
      return {
        'X-Tenant-Id': input.tenantId,
        // Legacy single-key header preserved for v1 platforms during rollout.
        'X-Platform-Signature': signed.routineSignature,
        // 2-key headers for upgraded platforms.
        'X-Vobase-Routine-Sig': signed.routineSignature,
        'X-Vobase-Rotation-Sig': signed.rotationSignature,
        'X-Vobase-Key-Version': String(signed.keyVersion),
      }
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
