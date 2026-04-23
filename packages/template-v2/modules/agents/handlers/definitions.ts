/**
 * /api/agents/definitions — CRUD for agent_definitions.
 *
 *   GET    /definitions        — list for org
 *   POST   /definitions        — create
 *   GET    /definitions/:id    — fetch single (full row)
 *   PATCH  /definitions/:id    — partial update (name/model/enabled/instructions/workingMemory)
 *   DELETE /definitions/:id    — delete
 */
import {
  create as createAgent,
  getById,
  list as listAgents,
  remove as removeAgent,
  update as updateAgent,
} from '@modules/agents/service/agent-definitions'
import { Hono } from 'hono'
import { z } from 'zod'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const createBody = z.object({
  name: z.string().min(1).max(120),
  model: z.string().min(1).max(120).optional(),
  instructions: z.string().optional(),
  workingMemory: z.string().optional(),
  enabled: z.boolean().optional(),
})

const updateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  model: z.string().min(1).max(120).optional(),
  instructions: z.string().optional(),
  workingMemory: z.string().optional(),
  enabled: z.boolean().optional(),
})

const app = new Hono()
  .get('/definitions', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const rows = await listAgents(organizationId)
    return c.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        model: r.model,
        enabled: r.enabled,
        updatedAt: r.updatedAt,
      })),
    )
  })
  .post('/definitions', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const raw = await c.req.json().catch(() => null)
    const parsed = createBody.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const row = await createAgent({ organizationId, ...parsed.data })
    return c.json(row, 201)
  })
  .get('/definitions/:id', async (c) => {
    try {
      const row = await getById(c.req.param('id'))
      return c.json(row)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })
  .patch('/definitions/:id', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = updateBody.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    try {
      const row = await updateAgent(c.req.param('id'), parsed.data)
      return c.json(row)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 404)
    }
  })
  .delete('/definitions/:id', async (c) => {
    await removeAgent(c.req.param('id'))
    return c.json({ ok: true })
  })

export default app
