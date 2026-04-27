/**
 * GET /api/team/staff/:userId/agent-view — returns one MEMORY.md entry per
 * agent that has accumulated memory about this staff member. Staff memory
 * is per-(agent, staff), so the response is a list of files keyed by agent.
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { listStaffMemoryByStaff } from '@modules/agents/service/staff-memory'
import type { AgentViewFile, AgentViewResponse } from '@modules/contacts/handlers/agent-view'
import { Hono } from 'hono'

const app = new Hono<OrganizationEnv>().use('*', requireOrganization).get('/staff/:userId/agent-view', async (c) => {
  const userId = c.req.param('userId')
  const organizationId = c.get('organizationId')
  const rows = await listStaffMemoryByStaff({ organizationId, staffId: userId })
  const files: AgentViewFile[] = rows
    .filter((r) => r.content?.trim().length > 0)
    .map((r) => ({
      path: `/agents/${r.agentId}/MEMORY.md`,
      title: `${r.agentName} (${r.agentId}) — MEMORY.md`,
      content: r.content,
    }))
  return c.json({ scope: `/staff/${userId}`, files } satisfies AgentViewResponse)
})

export default app
