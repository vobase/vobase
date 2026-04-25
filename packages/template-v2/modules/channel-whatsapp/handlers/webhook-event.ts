/**
 * POST /api/channel-whatsapp/webhook — receives Meta webhook events.
 *
 * Security: `verifyHmacWebhook` checks `X-Hub-Signature-256` against
 * `WHATSAPP_APP_SECRET` / `WA_WEBHOOK_SECRET`. `devBypass: true` allows
 * unsigned requests only when NODE_ENV != 'production' AND no secret is
 * configured (matches Meta's webhook validation dance).
 */
import { verifyHmacWebhook } from '@auth/middleware'
import type { Context } from 'hono'

import { processWebhookPayload } from '../service/inbound'
import { MetaWebhookPayloadSchema } from '../service/parser'

// Organization is resolved from channelInstanceId / env — never from an inbound header.
// Meta does not send x-organization-id; only attackers would set it.
const DEV_FALLBACK_ORG_ID = process.env.WA_DEFAULT_ORG_ID ?? undefined

export async function handleWebhookEvent(c: Context): Promise<Response> {
  const v = await verifyHmacWebhook(c, {
    secret: () => process.env.WHATSAPP_APP_SECRET ?? process.env.WA_WEBHOOK_SECRET ?? null,
    devBypass: true,
  })
  if (!v.ok) return v.response

  const parsed = MetaWebhookPayloadSchema.safeParse(v.payload)
  if (!parsed.success) {
    // Unknown Meta payload structure — ack to avoid retry flood.
    return c.json({ received: true, skipped: true }, 200)
  }

  // ── Dispatch to service ─────────────────────────────────────────────────────
  // Organization is NOT read from headers — Meta doesn't set x-organization-id and trusting
  // it would allow any caller to impersonate another organization. Instead, organizationId
  // is derived from the channelInstanceId lookup inside processWebhookPayload
  // (falling back to WA_DEFAULT_ORG_ID for dev single-organization setups).
  // The channelInstanceId may come from a route param (multi-instance routing),
  // but never from a caller-supplied header.
  const channelInstanceId = c.req.param('channelInstanceId') ?? undefined

  if (!channelInstanceId && !DEV_FALLBACK_ORG_ID && process.env.NODE_ENV === 'production') {
    return c.json({ error: 'missing channelInstanceId' }, 400)
  }

  const result = await processWebhookPayload(parsed.data, {
    organizationId: DEV_FALLBACK_ORG_ID ?? 'org-default',
    channelInstanceId,
  })

  return c.json({ received: true, ...result })
}
