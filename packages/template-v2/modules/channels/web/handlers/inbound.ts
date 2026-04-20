import { ChannelInboundEventSchema } from '@server/contracts/channel-event'
import { parseHubSignature } from '@server/runtime/hub-signature'
import { verifyHmacSignature } from '@vobase/core'
import type { Context } from 'hono'
import { requireContacts, requireInbox, requireJobs } from '../service/state'

const FALLBACK_SECRET = process.env.CHANNEL_WEB_WEBHOOK_SECRET ?? 'dev-secret'

export async function handleInbound(c: Context): Promise<Response> {
  const rawBody = await c.req.text()
  const sig = parseHubSignature(c)
  const secret = c.req.header('x-channel-secret') ?? FALLBACK_SECRET

  if (!verifyHmacSignature(rawBody, sig, secret)) {
    return c.json({ error: 'invalid signature' }, 401)
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }

  const parsed = ChannelInboundEventSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'invalid payload', issues: parsed.error.issues }, 422)
  }

  const event = parsed.data
  const inboxPort = requireInbox()
  const contactsPort = requireContacts()
  const jobs = requireJobs()

  const contact = await contactsPort.upsertByExternal({
    tenantId: event.tenantId,
    phone: `web:${event.from}`,
    displayName: event.profileName || undefined,
  })

  // Require channelInstanceId from header (set by web client or gateway)
  const channelInstanceId = c.req.header('x-channel-instance-id') ?? ''
  if (!channelInstanceId) {
    return c.json({ error: 'missing x-channel-instance-id header' }, 400)
  }

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
    await jobs.send('channel-web:inbound-to-wake', {
      tenantId: event.tenantId,
      conversationId: result.conversation.id,
      messageId: result.message.id,
      contactId: contact.id,
    })
  }

  return c.json({
    received: true,
    conversationId: result.conversation.id,
    messageId: result.message.id,
    deduplicated: !result.isNew,
  })
}
