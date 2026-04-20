/** GET /api/agents/conversations/:id/working-memory */
import { getConversationWorkingMemory } from '@modules/agents/service/agent-definitions'
import { Hono } from 'hono'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const app = new Hono()

app.get('/:id/working-memory', async (c) => {
  const id = c.req.param('id')
  const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
  const result = await getConversationWorkingMemory(id, organizationId)
  if (result === null) return c.json({ error: 'not_found' }, 404)
  return c.json(result)
})

export default app
