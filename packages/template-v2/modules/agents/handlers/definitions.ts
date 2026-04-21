/** GET /api/agents/definitions — list agent definitions for the active org. */
import { list as listAgents } from '@modules/agents/service/agent-definitions'
import { Hono } from 'hono'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const app = new Hono().get('/definitions', async (c) => {
  const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
  const rows = await listAgents(organizationId)
  return c.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
    })),
  )
})

export default app
