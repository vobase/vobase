/**
 * POST /api/messaging/conversations/:id/resolve — staff resolve (active→resolved)
 * POST /api/messaging/conversations/:id/reopen  — staff reopen  (resolved→active)
 * POST /api/messaging/conversations/:id/reset   — staff reset failed (failed→active)
 */
import { reopen, reset, resolve } from '@modules/messaging/service/conversations'
import { getConversation, notifyConversation } from '@modules/messaging/service/staff-ops'
import { InvalidTransitionError } from '@server/common/apply-transition'
import { Hono } from 'hono'
import { z } from 'zod'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const resolveBodySchema = z.object({
  by: z.string().min(1),
  reason: z.string().max(500).optional(),
})

const simpleBodySchema = z.object({
  by: z.string().min(1),
})

async function guardTenant(c: import('hono').Context, id: string, organizationId: string) {
  const conv = await getConversation(id)
  if (!conv) return { err: c.json({ error: 'not_found' }, 404) }
  if (conv.organizationId !== organizationId) return { err: c.json({ error: 'forbidden' }, 403) }
  return { conv }
}

const app = new Hono()
  .post('/:id/resolve', async (c) => {
    const id = c.req.param('id')
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const raw = await c.req.json().catch(() => ({}))
    const parsed = resolveBodySchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const guard = await guardTenant(c, id, organizationId)
    if (guard.err) return guard.err
    try {
      const conversation = await resolve(id, parsed.data.by, parsed.data.reason)
      await notifyConversation(id).catch(() => undefined)
      return c.json({ conversation })
    } catch (err) {
      if (err instanceof InvalidTransitionError) return c.json({ error: err.message, code: 'invalid_transition' }, 409)
      throw err
    }
  })
  .post('/:id/reopen', async (c) => {
    const id = c.req.param('id')
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const raw = await c.req.json().catch(() => ({}))
    const parsed = simpleBodySchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const guard = await guardTenant(c, id, organizationId)
    if (guard.err) return guard.err
    try {
      const conversation = await reopen(id, parsed.data.by, 'staff_reopen')
      await notifyConversation(id).catch(() => undefined)
      return c.json({ conversation })
    } catch (err) {
      if (err instanceof InvalidTransitionError) return c.json({ error: err.message, code: 'invalid_transition' }, 409)
      throw err
    }
  })
  .post('/:id/reset', async (c) => {
    const id = c.req.param('id')
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const raw = await c.req.json().catch(() => ({}))
    const parsed = simpleBodySchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const guard = await guardTenant(c, id, organizationId)
    if (guard.err) return guard.err
    try {
      const conversation = await reset(id, parsed.data.by)
      await notifyConversation(id).catch(() => undefined)
      return c.json({ conversation })
    } catch (err) {
      if (err instanceof InvalidTransitionError) return c.json({ error: err.message, code: 'invalid_transition' }, 409)
      throw err
    }
  })

export default app
