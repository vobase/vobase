/**
 * POST /api/channel-whatsapp/webhook — receives Meta webhook events.
 *
 * Security:
 *   1. Verify X-Hub-Signature-256 HMAC-SHA256 against WA_WEBHOOK_SECRET / WHATSAPP_APP_SECRET.
 *   2. Dev bypass: if no signature header AND secret env is unset, allow in NODE_ENV !== 'production'
 *      with a console.warn. Production always rejects unsigned requests.
 *
 * After signature check delegates entirely to service/inbound.ts (handler LOC ≤ 200).
 */
import { parseHubSignature } from '@server/runtime/hub-signature'
import { verifyHmacSignature } from '@vobase/core'
import type { Context } from 'hono'
import { processWebhookPayload } from '../service/inbound'
import { MetaWebhookPayloadSchema } from '../service/parser'
import { requireWebhookSecret } from '../service/state'

// Tenant is resolved from channelInstanceId / env — never from an inbound header.
// Meta does not send x-tenant-id; only attackers would set it.
const DEV_FALLBACK_TENANT_ID = process.env.WA_DEFAULT_TENANT_ID ?? undefined

export async function handleWebhookEvent(c: Context): Promise<Response> {
  const rawBody = await c.req.text()
  const sigHeader = c.req.header('x-hub-signature-256')

  // ── Signature verification ──────────────────────────────────────────────────
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? process.env.WA_WEBHOOK_SECRET
  const secretConfigured = !!appSecret

  if (!sigHeader) {
    // No signature present
    if (secretConfigured || process.env.NODE_ENV === 'production') {
      return c.json({ error: 'missing x-hub-signature-256' }, 403)
    }
    // Dev-only bypass: allow unsigned requests when no secret is configured
    console.warn(
      '[channel-whatsapp] WARNING: Accepting unsigned webhook (no WHATSAPP_APP_SECRET set). Set the env var in production.',
    )
  } else {
    const sig = parseHubSignature(c)
    const secret = requireWebhookSecret()
    if (!verifyHmacSignature(rawBody, sig, secret)) {
      return c.json({ error: 'invalid signature' }, 401)
    }
  }

  // ── Parse payload ───────────────────────────────────────────────────────────
  let rawPayload: unknown
  try {
    rawPayload = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }

  const parsed = MetaWebhookPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) {
    // Unknown Meta payload structure — ack to avoid retry flood.
    return c.json({ received: true, skipped: true }, 200)
  }

  // ── Dispatch to service ─────────────────────────────────────────────────────
  // Tenant is NOT read from headers — Meta doesn't set x-tenant-id and trusting
  // it would allow any caller to impersonate another tenant. Instead, tenantId
  // is derived from the channelInstanceId lookup inside processWebhookPayload
  // (falling back to WA_DEFAULT_TENANT_ID for dev single-tenant setups).
  // The channelInstanceId may come from a route param (multi-instance routing),
  // but never from a caller-supplied header.
  const channelInstanceId = c.req.param('channelInstanceId') ?? undefined

  if (!channelInstanceId && !DEV_FALLBACK_TENANT_ID && process.env.NODE_ENV === 'production') {
    return c.json({ error: 'missing channelInstanceId' }, 400)
  }

  const result = await processWebhookPayload(parsed.data, {
    tenantId: DEV_FALLBACK_TENANT_ID ?? 'tenant-default',
    channelInstanceId,
  })

  return c.json({ received: true, ...result })
}
