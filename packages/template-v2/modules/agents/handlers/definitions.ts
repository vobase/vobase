/**
 * /api/agents/definitions — CRUD for agent_definitions.
 *
 *   GET    /definitions        — list for org
 *   POST   /definitions        — create
 *   GET    /definitions/:id    — fetch single (full row)
 *   PATCH  /definitions/:id    — partial update (name/model/enabled/instructions/workingMemory)
 *   DELETE /definitions/:id    — delete
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import {
  create as createAgent,
  getById,
  list as listAgents,
  remove as removeAgent,
  update as updateAgent,
} from '@modules/agents/service/agent-definitions'
import { conversationVerbs, driveVerbs, generateAgentsMd, teamVerbs } from '@modules/agents/workspace'
import { Hono } from 'hono'
import { z } from 'zod'

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

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .get('/definitions', async (c) => {
    const rows = await listAgents(c.get('organizationId'))
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
  .post(
    '/definitions',
    zValidator('json', createBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      const row = await createAgent({ organizationId: c.get('organizationId'), ...data })
      return c.json(row, 201)
    },
  )
  .get('/definitions/:id', async (c) => {
    try {
      const row = await getById(c.req.param('id'))
      return c.json(row)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })
  .get('/definitions/:id/agents-md', async (c) => {
    try {
      const row = await getById(c.req.param('id'))
      const preamble = generateAgentsMd({
        agentName: row.name,
        agentId: row.id,
        commands: [...teamVerbs, ...conversationVerbs, ...driveVerbs],
        instructions: '',
      }).replace(/\n## Instructions\n[\s\S]*$/, '\n')
      return c.json({ preamble })
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })
  .patch(
    '/definitions/:id',
    zValidator('json', updateBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      try {
        const row = await updateAgent(c.req.param('id'), data)
        return c.json(row)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return c.json({ error: msg }, 404)
      }
    },
  )
  .delete('/definitions/:id', async (c) => {
    await removeAgent(c.req.param('id'))
    return c.json({ ok: true })
  })

export default app
