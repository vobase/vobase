/** POST /api/messaging/conversations/:id/reassign */

import { zValidator } from '@hono/zod-validator'
import { reassign } from '@modules/messaging/service/conversations'
import { getConversation, notifyConversation } from '@modules/messaging/service/staff-ops'
import { Hono } from 'hono'
import { z } from 'zod'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const reassignBodySchema = z.object({
  assignee: z.string().min(1),
  by: z.string().min(1).optional(),
  note: z.string().optional(),
})

const app = new Hono().post(
  '/:id/reassign',
  zValidator('json', reassignBodySchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
  }),
  async (c) => {
    const id = c.req.param('id')
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const data = c.req.valid('json')
    const conv = await getConversation(id)
    if (!conv) return c.json({ error: 'not_found' }, 404)
    if (conv.organizationId !== organizationId) return c.json({ error: 'forbidden' }, 403)
    const conversation = await reassign(id, data.assignee, data.by ?? 'system', data.note)
    await notifyConversation(id).catch(() => undefined)
    return c.json({ conversation })
  },
)

export default app
