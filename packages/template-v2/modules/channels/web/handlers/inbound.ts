import { ChannelInboundEventSchema } from '@server/contracts/channel-event'
import { verifyHmacWebhook } from '@server/middlewares'
import type { Context } from 'hono'
import { requireContacts, requireInbox, requireJobs } from '../service/state'

const FALLBACK_SECRET = process.env.CHANNEL_WEB_WEBHOOK_SECRET ?? 'dev-secret'

export async function handleInbound(c: Context): Promise<Response> {
  const v = await verifyHmacWebhook(c, {
    secret: (ctx) => ctx.req.header('x-channel-secret') ?? FALLBACK_SECRET,
  })
  if (!v.ok) return v.response

  const parsed = ChannelInboundEventSchema.safeParse(v.payload)
  if (!parsed.success) {
    return c.json({ error: 'invalid payload', issues: parsed.error.issues }, 422)
  }

  const event = parsed.data
  const inboxPort = requireInbox()
  const contactsPort = requireContacts()
  const jobs = requireJobs()

  const contact = await contactsPort.upsertByExternal({
    organizationId: event.organizationId,
    phone: `web:${event.from}`,
    displayName: event.profileName || undefined,
  })

  // Require channelInstanceId from header (set by web client or gateway)
  const channelInstanceId = c.req.header('x-channel-instance-id') ?? ''
  if (!channelInstanceId) {
    return c.json({ error: 'missing x-channel-instance-id header' }, 400)
  }

  const result = await inboxPort.createInboundMessage({
    organizationId: event.organizationId,
    channelInstanceId,
    contactId: contact.id,
    externalMessageId: event.externalMessageId,
    content: event.content,
    contentType: event.contentType,
    profileName: event.profileName,
  })

  if (result.isNew) {
    await jobs.send('channel-web:inbound-to-wake', {
      organizationId: event.organizationId,
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
