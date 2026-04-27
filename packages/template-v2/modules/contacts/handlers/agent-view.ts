/**
 * GET /api/contacts/:id/agent-view — returns the materialized files an
 * agent sees for this contact (profile + memory). Same shape as the agent
 * and staff views so `<AgentViewPane>` is uniform.
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import * as contactsSvc from '@modules/contacts/service/contacts'
import { Hono } from 'hono'

export interface AgentViewFile {
  path: string
  title: string
  content: string
}

export interface AgentViewResponse {
  scope: string
  files: AgentViewFile[]
}

const app = new Hono<OrganizationEnv>().use('*', requireOrganization).get('/:id/agent-view', async (c) => {
  const id = c.req.param('id')
  const organizationId = c.get('organizationId')
  try {
    const contact = await contactsSvc.get(id)
    if (contact.organizationId !== organizationId) return c.json({ error: 'not_found' }, 404)
    const notes = await contactsSvc.readNotes(id)
    const files: AgentViewFile[] = []
    if (contact.profile && contact.profile.trim().length > 0) {
      files.push({ path: '/profile.md', title: 'profile.md', content: contact.profile })
    }
    if (notes && notes.trim().length > 0) {
      files.push({ path: '/MEMORY.md', title: 'MEMORY.md', content: notes })
    }
    return c.json({ scope: `/contacts/${id}`, files } satisfies AgentViewResponse)
  } catch {
    return c.json({ error: 'not_found' }, 404)
  }
})

export default app
