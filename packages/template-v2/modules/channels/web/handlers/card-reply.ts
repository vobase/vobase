import { get as getConversation } from '@modules/inbox/service/conversations'
import { appendCardReplyMessage } from '@modules/inbox/service/messages'
import type { Context } from 'hono'
import { z } from 'zod'
import { requireJobs } from '../service/state'

const CardReplyBodySchema = z.object({
  messageId: z.string().min(1),
  buttonId: z.string().min(1),
  buttonValue: z.string(),
  buttonLabel: z.string().optional(),
})

export async function handleCardReply(c: Context): Promise<Response> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }

  const parsed = CardReplyBodySchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'invalid payload', issues: parsed.error.issues }, 422)
  }

  const { messageId, buttonId, buttonValue, buttonLabel } = parsed.data
  const jobs = requireJobs()

  let reply: Awaited<ReturnType<typeof appendCardReplyMessage>>
  try {
    reply = await appendCardReplyMessage({ parentMessageId: messageId, buttonId, buttonValue, buttonLabel })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('not found')) return c.json({ error: 'parent message not found' }, 404)
    return c.json({ error: 'internal error' }, 500)
  }

  const conv = await getConversation(reply.conversationId)

  await jobs.send('channel-web:inbound-to-wake', {
    organizationId: reply.organizationId,
    conversationId: reply.conversationId,
    messageId: reply.id,
    contactId: conv.contactId,
  })

  return c.json({
    ok: true,
    messageId: reply.id,
    conversationId: reply.conversationId,
  })
}
