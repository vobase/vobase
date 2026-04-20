/** POST /api/inbox/conversations/:id/reassign */
import { reassign } from '@modules/inbox/service/conversations'
import { getConversation, notifyConversation } from '@modules/inbox/service/staff-ops'
import { Hono } from 'hono'
import { z } from 'zod'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const reassignBodySchema = z.object({
  assignee: z.string().min(1),
  by: z.string().min(1).optional(),
  note: z.string().optional(),
})

const app = new Hono()

app.post('/:id/reassign', async (c) => {
  const id = c.req.param('id')
  const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
  const raw = await c.req.json().catch(() => null)
  const parsed = reassignBodySchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
  }
  const conv = await getConversation(id)
  if (!conv) return c.json({ error: 'not_found' }, 404)
  if (conv.organizationId !== organizationId) return c.json({ error: 'forbidden' }, 403)
  const conversation = await reassign(id, parsed.data.assignee, parsed.data.by ?? 'system', parsed.data.note)
  await notifyConversation(id).catch(() => undefined)
  return c.json({ conversation })
})

export default app
