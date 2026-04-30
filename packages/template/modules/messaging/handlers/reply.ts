/** POST /api/messaging/conversations/:id/reply */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import { getConversation, notifyConversation } from '@modules/messaging/service/staff-ops'
import { sendStaffReply } from '@modules/messaging/service/staff-reply'
import { Hono } from 'hono'
import { z } from 'zod'

const replyBodySchema = z.object({
  body: z.string().min(1).max(10_000),
  staffUserId: z.string().min(1).optional(),
})

const app = new Hono<OrganizationEnv>().use('*', requireOrganization).post(
  '/:id/reply',
  zValidator('json', replyBodySchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
  }),
  async (c) => {
    const id = c.req.param('id')
    const organizationId = c.get('organizationId')
    const data = c.req.valid('json')
    const conv = await getConversation(id)
    if (!conv) return c.json({ error: 'not_found' }, 404)
    if (conv.organizationId !== organizationId) return c.json({ error: 'not_found' }, 404)
    const sessionUserId = c.get('session').user?.id
    const staffUserId = data.staffUserId ?? sessionUserId ?? 'staff'
    const { messageId } = await sendStaffReply({
      conversationId: id,
      organizationId,
      staffUserId,
      body: data.body,
    })
    await notifyConversation(id).catch(() => undefined)
    return c.json({ messageId })
  },
)

export default app
