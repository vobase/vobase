/** GET /api/agents/conversations/:id/working-memory */
import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { getConversationWorkingMemory } from '@modules/agents/service/agent-definitions'
import { Hono } from 'hono'

const app = new Hono<OrganizationEnv>().use('*', requireOrganization).get('/:id/working-memory', async (c) => {
  const id = c.req.param('id')
  const result = await getConversationWorkingMemory(id, c.get('organizationId'))
  if (result === null) return c.json({ error: 'not_found' }, 404)
  return c.json(result)
})

export default app
