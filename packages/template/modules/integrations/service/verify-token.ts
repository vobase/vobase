/**
 * Deterministic verify-token derivation for platform webhook registration.
 *
 * The platform sends Meta-style hub challenges (`hub.mode=subscribe` +
 * `hub.verify_token` + `hub.challenge`) against the tenant's webhook URL
 * during registration. The tenant's WhatsApp adapter answers via its
 * existing `handleWebhookChallenge`, comparing the `hub.verify_token` to
 * the value passed into `createWhatsAppAdapter({ webhookVerifyToken })`.
 *
 * To avoid storing yet another secret, we derive the token deterministically
 * via HKDF-SHA256 from `BETTER_AUTH_SECRET` (already required for auth +
 * envelope encryption). Same derivation runs at registration time AND
 * inside the adapter, so the platform challenge and the tenant's compare
 * always agree without explicit coordination.
 *
 * Stateless. No DB write. Rotates only when `BETTER_AUTH_SECRET` rotates.
 */
/** @contract platform-tenant-v1 */

import { createHmac } from 'node:crypto'

/**
 * HKDF-SHA256(BETTER_AUTH_SECRET, salt='vobase-webhook-verify-v1',
 * info=`${tenantSlug}/${environment}/${provider}`, L=32).
 *
 * Output: 64 hex chars (32 bytes). Plenty of entropy for a verify token.
 *
 * Per-provider info field means a future Stripe verify token can't be
 * substituted for the WhatsApp one — different infos derive different
 * tokens even with identical (tenant, env).
 */
export function deriveVerifyToken(input: {
  tenantSlug: string
  environment: string
  provider: string
  betterAuthSecret: string
}): string {
  const salt = Buffer.from('vobase-webhook-verify-v1', 'utf8')
  const ikm = Buffer.from(input.betterAuthSecret, 'utf8')
  const info = Buffer.from(`${input.tenantSlug}/${input.environment}/${input.provider}`, 'utf8')
  return hkdfSha256(ikm, salt, info, 32).toString('hex')
}

/**
 * Minimal HKDF-SHA256 (RFC 5869). Two-step extract → expand. Sufficient for
 * single-block (L ≤ 32) outputs we need here.
 */
function hkdfSha256(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  if (length > 32) {
    throw new Error('hkdfSha256: this minimal impl only supports L <= 32')
  }
  // Extract: PRK = HMAC-SHA256(salt, IKM)
  const prk = createHmac('sha256', salt).update(ikm).digest()
  // Expand: T(1) = HMAC-SHA256(PRK, info || 0x01); OKM = first L bytes of T(1)
  const t1 = createHmac('sha256', prk)
    .update(info)
    .update(Buffer.from([0x01]))
    .digest()
  return t1.subarray(0, length)
}
