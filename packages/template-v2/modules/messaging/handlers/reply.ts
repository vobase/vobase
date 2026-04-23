/** POST /api/messaging/conversations/:id/reply */
import { getConversation, notifyConversation } from '@modules/messaging/service/staff-ops'
import { sendStaffReply } from '@modules/messaging/service/staff-reply'
import { Hono } from 'hono'
import { z } from 'zod'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const replyBodySchema = z.object({
  body: z.string().min(1).max(10_000),
  staffUserId: z.string().min(1).optional(),
})

const app = new Hono().post('/:id/reply', async (c) => {
  const id = c.req.param('id')
  const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
  const raw = await c.req.json().catch(() => null)
  const parsed = replyBodySchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
  }
  const conv = await getConversation(id)
  if (!conv) return c.json({ error: 'not_found' }, 404)
  if (conv.organizationId !== organizationId) return c.json({ error: 'not_found' }, 404)
  const session = (c as unknown as { get: (k: string) => { user?: { id?: string } } | undefined }).get('session')
  const sessionUserId = session?.user?.id
  const staffUserId = parsed.data.staffUserId ?? sessionUserId ?? 'staff'
  const { messageId } = await sendStaffReply({
    conversationId: id,
    organizationId,
    staffUserId,
    body: parsed.data.body,
  })
  await notifyConversation(id).catch(() => undefined)
  return c.json({ messageId })
})

export default app
