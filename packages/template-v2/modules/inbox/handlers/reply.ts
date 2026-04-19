/** POST /api/inbox/conversations/:id/reply */
import { getConversation, notifyConversation } from '@modules/inbox/service/staff-ops'
import { sendStaffReply } from '@modules/inbox/service/staff-reply'
import { Hono } from 'hono'
import { z } from 'zod'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const replyBodySchema = z.object({
  body: z.string().min(1).max(10_000),
  staffUserId: z.string().min(1).optional(),
})

const app = new Hono()

app.post('/:id/reply', async (c) => {
  const id = c.req.param('id')
  const tenantId = c.req.query('tenantId') ?? DEFAULT_TENANT
  const raw = await c.req.json().catch(() => null)
  const parsed = replyBodySchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
  }
  const conv = await getConversation(id)
  if (!conv) return c.json({ error: 'not_found' }, 404)
  if (conv.tenantId !== tenantId) return c.json({ error: 'not_found' }, 404)
  const staffUserId = parsed.data.staffUserId ?? 'staff'
  const { messageId } = await sendStaffReply({
    conversationId: id,
    tenantId,
    staffUserId,
    body: parsed.data.body,
  })
  await notifyConversation(id).catch(() => undefined)
  return c.json({ messageId })
})

export default app
