/**
 * CRUD routes for web channel instances — powers the /channels page.
 */

import {
  createInstance,
  getPublicInstance,
  listInstances,
  removeInstance,
  updateInstance,
} from '@server/transports/web/service/instances'
import { Hono } from 'hono'
import { z } from 'zod'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const startersSchema = z.array(z.string().min(1).max(120)).max(8)

const createBody = z.object({
  displayName: z.string().min(1).max(120),
  defaultAssignee: z.string().min(1).optional().nullable(),
  origin: z.string().url().optional().nullable(),
  starters: startersSchema.optional().nullable(),
})

const updateBody = z.object({
  displayName: z.string().min(1).max(120).optional(),
  defaultAssignee: z.string().min(1).nullable().optional(),
  origin: z.string().url().nullable().optional(),
  starters: startersSchema.nullable().optional(),
})

const app = new Hono()
  .get('/:id/public', async (c) => {
    const id = c.req.param('id')
    const pub = await getPublicInstance(id)
    if (!pub) return c.json({ error: 'not_found' }, 404)
    return c.json(pub)
  })
  .get('/', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const rows = await listInstances(organizationId)
    return c.json(rows)
  })
  .post('/', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const raw = await c.req.json().catch(() => null)
    const parsed = createBody.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    }
    const instance = await createInstance({
      organizationId,
      displayName: parsed.data.displayName,
      defaultAssignee: parsed.data.defaultAssignee ?? null,
      origin: parsed.data.origin ?? null,
      starters: parsed.data.starters ?? null,
    })
    return c.json(instance, 201)
  })
  .patch('/:id', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const id = c.req.param('id')
    const raw = await c.req.json().catch(() => null)
    const parsed = updateBody.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    }
    try {
      const instance = await updateInstance(id, organizationId, parsed.data)
      return c.json(instance)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })
  .delete('/:id', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const id = c.req.param('id')
    await removeInstance(id, organizationId)
    return c.json({ ok: true })
  })

export default app
