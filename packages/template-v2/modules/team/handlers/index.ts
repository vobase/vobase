import {
  get as getStaff,
  list as listStaff,
  remove as removeStaff,
  update as updateStaff,
  upsert as upsertStaff,
} from '@modules/team/service/staff'
import { Hono } from 'hono'
import { z } from 'zod'

import attributeHandlers from './attributes'
import descriptionHandlers from './descriptions'
import heartbeatHandlers from './heartbeat'
import mentionHandlers from './mentions'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const availability = z.enum(['active', 'busy', 'off', 'inactive'])

const upsertStaffBody = z.object({
  userId: z.string().min(1).max(64),
  displayName: z.string().trim().min(1).max(200).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  sectors: z.array(z.string().min(1)).optional(),
  expertise: z.array(z.string().min(1)).optional(),
  languages: z.array(z.string().min(1)).optional(),
  capacity: z.number().int().min(0).max(1000).optional(),
  availability: availability.optional(),
  profile: z.string().max(4000).optional(),
  notes: z.string().max(8000).optional(),
})

const updateStaffBody = z.object({
  displayName: z.string().trim().min(1).max(200).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  sectors: z.array(z.string().min(1)).optional(),
  expertise: z.array(z.string().min(1)).optional(),
  languages: z.array(z.string().min(1)).optional(),
  capacity: z.number().int().min(0).max(1000).optional(),
  availability: availability.optional(),
  profile: z.string().max(4000).optional(),
  notes: z.string().max(8000).optional(),
})

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'team', status: 'ok' }))
  .route('/', attributeHandlers)
  .route('/', descriptionHandlers)
  .route('/', heartbeatHandlers)
  .route('/', mentionHandlers)
  .get('/staff', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const rows = await listStaff(organizationId)
    return c.json(rows)
  })
  .post('/staff', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = upsertStaffBody.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const row = await upsertStaff({ organizationId, ...parsed.data })
    return c.json(row)
  })
  .get('/staff/:userId', async (c) => {
    try {
      const row = await getStaff(c.req.param('userId'))
      return c.json(row)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })
  .patch('/staff/:userId', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = updateStaffBody.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    try {
      const row = await updateStaff(c.req.param('userId'), parsed.data)
      return c.json(row)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })
  .delete('/staff/:userId', async (c) => {
    await removeStaff(c.req.param('userId'))
    return c.json({ ok: true, userId: c.req.param('userId') })
  })

export default app
