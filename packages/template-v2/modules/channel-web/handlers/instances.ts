/**
 * CRUD routes for web channel instances — powers the /channels page.
 */

import { zValidator } from '@hono/zod-validator'
import {
  createInstance,
  getPublicInstance,
  listInstances,
  removeInstance,
  updateInstance,
} from '@modules/channel-web/service/instances'
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

const invalidBody = (
  result: { success: boolean; error?: { issues: unknown } },
  c: { json: (b: unknown, s: number) => Response },
) => (result.success ? undefined : c.json({ error: 'invalid_body', issues: result.error?.issues }, 400))

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
  .post('/', zValidator('json', createBody, invalidBody), async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const data = c.req.valid('json')
    const instance = await createInstance({
      organizationId,
      displayName: data.displayName,
      defaultAssignee: data.defaultAssignee ?? null,
      origin: data.origin ?? null,
      starters: data.starters ?? null,
    })
    return c.json(instance, 201)
  })
  .patch('/:id', zValidator('json', updateBody, invalidBody), async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const id = c.req.param('id')
    const data = c.req.valid('json')
    try {
      const instance = await updateInstance(id, organizationId, data)
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
