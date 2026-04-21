/**
 * POST /api/inbox/conversations/:id/snooze
 * POST /api/inbox/conversations/:id/unsnooze
 */
import { SnoozeNotAllowedError, snooze, unsnooze } from '@modules/inbox/service/conversations'
import { getConversation, notifyConversation } from '@modules/inbox/service/staff-ops'
import { Hono } from 'hono'
import { z } from 'zod'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const snoozeBodySchema = z.object({
  until: z.string().datetime(),
  by: z.string().min(1),
  reason: z.string().max(500).optional(),
})

const unsnoozeBodySchema = z.object({
  by: z.string().min(1),
})

const app = new Hono()
  .post('/:id/snooze', async (c) => {
    const id = c.req.param('id')
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const raw = await c.req.json().catch(() => null)
    const parsed = snoozeBodySchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)

    const conv = await getConversation(id)
    if (!conv) return c.json({ error: 'not_found' }, 404)
    if (conv.organizationId !== organizationId) return c.json({ error: 'forbidden' }, 403)

    const until = new Date(parsed.data.until)
    if (until.getTime() <= Date.now()) return c.json({ error: 'until_must_be_future' }, 400)

    try {
      const conversation = await snooze({
        conversationId: id,
        until,
        by: parsed.data.by,
        reason: parsed.data.reason,
      })
      await notifyConversation(id).catch(() => undefined)
      return c.json({ conversation })
    } catch (err) {
      if (err instanceof SnoozeNotAllowedError) {
        return c.json({ error: err.message, code: err.code }, 409)
      }
      throw err
    }
  })
  .post('/:id/unsnooze', async (c) => {
    const id = c.req.param('id')
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const raw = await c.req.json().catch(() => null)
    const parsed = unsnoozeBodySchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)

    const conv = await getConversation(id)
    if (!conv) return c.json({ error: 'not_found' }, 404)
    if (conv.organizationId !== organizationId) return c.json({ error: 'forbidden' }, 403)

    const conversation = await unsnooze(id, parsed.data.by)
    await notifyConversation(id).catch(() => undefined)
    return c.json({ conversation })
  })

export default app
