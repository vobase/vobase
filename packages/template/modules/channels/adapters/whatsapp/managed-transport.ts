/**
 * Managed-mode `WhatsAppTransportConfig` builder.
 *
 * In managed mode, all Graph API calls + media downloads are proxied through
 * the platform's `/api/managed-whatsapp/:platformChannelId/...` surface. The
 * transport rewrites Graph paths to the platform proxy and signs requests with
 * the 2-key HMAC contract (routine + rotation, monotonic keyVersion).
 *
 * Inbound webhooks (forwarded by the platform's per-environment router) carry
 * the same signed-headers contract; `verifyInboundWebhook` accepts current OR
 * previous-during-grace per the rotation window.
 */

import type { VaultRotation } from '@modules/integrations/service/vault'
import type { WhatsAppTransportConfig } from '@vobase/core'
import { signRequest, verifyRequest } from '@vobase/core'

export interface ManagedTransportInput {
  /** Platform-issued channel id (per-tenant + per-env). */
  platformChannelId: string
  /** Origin of the platform service, e.g. `https://platform.voltade.app`. */
  platformBaseUrl: string
  /** Tenant identity headers attached to every proxied request. */
  tenantId: string
  /** Current 2-key pair from the integrations vault. */
  current: VaultRotation['current']
  /** Optional previous pair held during rotation grace. */
  previous: VaultRotation['previous']
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
      const payload = `${method.toUpperCase()}${path}`
      const signed = signRequest({
        body: payload,
        routineSecret: input.current.routineSecret,
        rotationKey: input.current.rotationKey,
        keyVersion: input.current.keyVersion,
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
  }
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
