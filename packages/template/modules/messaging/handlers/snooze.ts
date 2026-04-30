/**
 * POST /api/messaging/conversations/:id/snooze
 * POST /api/messaging/conversations/:id/unsnooze
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import { SnoozeNotAllowedError, snooze, unsnooze } from '@modules/messaging/service/conversations'
import { getConversation, notifyConversation } from '@modules/messaging/service/staff-ops'
import { Hono } from 'hono'
import { z } from 'zod'

const snoozeBodySchema = z.object({
  until: z.string().datetime(),
  by: z.string().min(1),
  reason: z.string().max(500).optional(),
})

const unsnoozeBodySchema = z.object({
  by: z.string().min(1),
})

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .post(
    '/:id/snooze',
    zValidator('json', snoozeBodySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const id = c.req.param('id')
      const data = c.req.valid('json')

      const conv = await getConversation(id)
      if (!conv) return c.json({ error: 'not_found' }, 404)
      if (conv.organizationId !== c.get('organizationId')) return c.json({ error: 'forbidden' }, 403)

      const until = new Date(data.until)
      if (until.getTime() <= Date.now()) return c.json({ error: 'until_must_be_future' }, 400)

      try {
        const conversation = await snooze({
          conversationId: id,
          until,
          by: data.by,
          reason: data.reason,
        })
        await notifyConversation(id).catch(() => undefined)
        return c.json({ conversation })
      } catch (err) {
        if (err instanceof SnoozeNotAllowedError) {
          return c.json({ error: err.message, code: err.code }, 409)
        }
        throw err
      }
    },
  )
  .post(
    '/:id/unsnooze',
    zValidator('json', unsnoozeBodySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const id = c.req.param('id')
      const data = c.req.valid('json')

      const conv = await getConversation(id)
      if (!conv) return c.json({ error: 'not_found' }, 404)
      if (conv.organizationId !== c.get('organizationId')) return c.json({ error: 'forbidden' }, 403)

      const conversation = await unsnooze(id, data.by)
      await notifyConversation(id).catch(() => undefined)
      return c.json({ conversation })
    },
  )

export default app
