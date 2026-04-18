/**
 * POST /api/channel-whatsapp/webhook — receives Meta webhook events.
 *
 * Verifies X-Hub-Signature-256 via Core signHmac, parses payload into
 * canonical ChannelInboundEvents, delegates to InboxPort for persistence,
 * enqueues wake job. LOC ≤ 200.
 */
import { parseHubSignature } from '@server/runtime/hub-signature'
import { verifyHmacSignature } from '@vobase/core'
import type { Context } from 'hono'
import { MetaWebhookPayloadSchema, parseWebhookPayload } from '../service/parser'
import { requireContacts, requireInbox, requireJobs, requireWebhookSecret } from '../service/state'

const FALLBACK_TENANT_ID = process.env.DEFAULT_TENANT_ID ?? 'tenant-default'
const FALLBACK_CHANNEL_INSTANCE_ID = process.env.WA_CHANNEL_INSTANCE_ID ?? ''

export async function handleWebhookEvent(c: Context): Promise<Response> {
  const rawBody = await c.req.text()
  const sig = parseHubSignature(c)

  if (!verifyHmacSignature(rawBody, sig, requireWebhookSecret())) {
    return c.json({ error: 'invalid signature' }, 401)
  }

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

  const tenantId = c.req.header('x-tenant-id') ?? FALLBACK_TENANT_ID
  const channelInstanceId = c.req.header('x-channel-instance-id') ?? FALLBACK_CHANNEL_INSTANCE_ID

  const events = parseWebhookPayload(parsed.data, tenantId)
  const inboxPort = requireInbox()
  const contactsPort = requireContacts()
  const jobs = requireJobs()

  const results = await Promise.all(
    events.map(async (event) => {
      if (event.contentType === 'unsupported' && (event.metadata as Record<string, unknown>)?.waStatusUpdate) {
        return null
      }
      const contact = await contactsPort.upsertByExternal({
        tenantId: event.tenantId,
        phone: event.from,
        displayName: event.profileName || undefined,
      })
      const result = await inboxPort.createInboundMessage({
        tenantId: event.tenantId,
        channelInstanceId,
        contactId: contact.id,
        externalMessageId: event.externalMessageId,
        content: event.content,
        contentType: event.contentType,
        profileName: event.profileName,
      })
      if (result.isNew) {
        await jobs.send('channel-whatsapp:inbound-to-wake', {
          tenantId: event.tenantId,
          conversationId: result.conversation.id,
          messageId: result.message.id,
          contactId: contact.id,
        })
      }
      return { externalMessageId: event.externalMessageId, isNew: result.isNew }
    }),
  )
  const processed = results.filter((r): r is NonNullable<typeof r> => r !== null)
  return c.json({ received: true, processed: processed.length, results: processed })
}
