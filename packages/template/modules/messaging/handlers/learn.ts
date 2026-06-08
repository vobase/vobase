/**
 * POST /api/messaging/conversations/:id/learn
 *
 * Staff-triggered "learn from this thread" — enqueues a manual learning-triage
 * pass over the conversation, chunked into windows. Always allowed (the
 * automatic kill-switch `LEARN_AUTO_TRIAGE` does not gate the manual path).
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import { get as getConversation } from '@modules/messaging/service/conversations'
import { ManualLearningError, triggerLearning } from '@modules/messaging/service/manual-learning'
import { Hono } from 'hono'
import { z } from 'zod'

const learnBodySchema = z.object({
  /** Optional explicit agent; otherwise resolved from assignee → channel default. */
  agentId: z.string().min(1).optional(),
})

const app = new Hono<OrganizationEnv>().use('*', requireOrganization).post(
  '/:id/learn',
  zValidator('json', learnBodySchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
  }),
  async (c) => {
    const id = c.req.param('id')
    const { agentId } = c.req.valid('json')

    // Tenant scoping: the conversation must belong to the caller's org.
    let conv: Awaited<ReturnType<typeof getConversation>>
    try {
      conv = await getConversation(id)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
    if (conv.organizationId !== c.get('organizationId')) return c.json({ error: 'forbidden' }, 403)

    try {
      const result = await triggerLearning({ conversationId: id, agentId })
      return c.json(result)
    } catch (e) {
      if (e instanceof ManualLearningError) {
        return c.json({ error: e.code, message: e.message }, e.code === 'conversation_not_found' ? 404 : 422)
      }
      throw e
    }
  },
)

export default app
