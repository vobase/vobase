/**
 * POST /api/messaging/conversations/:id/resolve — staff resolve (active→resolved)
 * POST /api/messaging/conversations/:id/reopen  — staff reopen  (resolved→active)
 * POST /api/messaging/conversations/:id/reset   — staff reset failed (failed→active)
 */

import { zValidator } from '@hono/zod-validator'
import { reopen, reset, resolve } from '@modules/messaging/service/conversations'
import { getConversation, notifyConversation } from '@modules/messaging/service/staff-ops'
import { Hono } from 'hono'
import { z } from 'zod'

import { InvalidTransitionError } from '~/runtime'

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
  .post(
    '/:id/resolve',
    zValidator('json', resolveBodySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const id = c.req.param('id')
      const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
      const data = c.req.valid('json')
      const guard = await guardTenant(c, id, organizationId)
      if (guard.err) return guard.err
      try {
        const conversation = await resolve(id, data.by, data.reason)
        await notifyConversation(id).catch(() => undefined)
        return c.json({ conversation })
      } catch (err) {
        if (err instanceof InvalidTransitionError)
          return c.json({ error: err.message, code: 'invalid_transition' }, 409)
        throw err
      }
    },
  )
  .post(
    '/:id/reopen',
    zValidator('json', simpleBodySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const id = c.req.param('id')
      const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
      const data = c.req.valid('json')
      const guard = await guardTenant(c, id, organizationId)
      if (guard.err) return guard.err
      try {
        const conversation = await reopen(id, data.by, 'staff_reopen')
        await notifyConversation(id).catch(() => undefined)
        return c.json({ conversation })
      } catch (err) {
        if (err instanceof InvalidTransitionError)
          return c.json({ error: err.message, code: 'invalid_transition' }, 409)
        throw err
      }
    },
  )
  .post(
    '/:id/reset',
    zValidator('json', simpleBodySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const id = c.req.param('id')
      const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
      const data = c.req.valid('json')
      const guard = await guardTenant(c, id, organizationId)
      if (guard.err) return guard.err
      try {
        const conversation = await reset(id, data.by)
        await notifyConversation(id).catch(() => undefined)
        return c.json({ conversation })
      } catch (err) {
        if (err instanceof InvalidTransitionError)
          return c.json({ error: err.message, code: 'invalid_transition' }, 409)
        throw err
      }
    },
  )

export default app
