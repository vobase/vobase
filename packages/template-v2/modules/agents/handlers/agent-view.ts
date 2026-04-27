/**
 * GET /api/agents/:id/agent-view — returns the materialized files for an
 * agent: AGENTS.md (instructions), MEMORY.md (working memory), one
 * `/skills/<name>.md` per learned skill (real body) or per allowlisted name
 * (placeholder), AND any real drive files persisted under
 * `scope='agent', scope_id=:id` (drive_doc proposals approved against this
 * agent write here).
 *
 * Learned skills with `agent_id = NULL` (org-floating post-approval rows)
 * are surfaced too.
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import * as agentDefs from '@modules/agents/service/agent-definitions'
import { listSkillsForAgent } from '@modules/agents/service/changes'
import type { AgentViewFile, AgentViewResponse } from '@modules/contacts/handlers/agent-view'
import type { DriveFile } from '@modules/drive/schema'
import { filesServiceFor } from '@modules/drive/service/files'
import { Hono } from 'hono'

const app = new Hono<OrganizationEnv>().use('*', requireOrganization).get('/:id/agent-view', async (c) => {
  const id = c.req.param('id')
  const organizationId = c.get('organizationId')
  try {
    const agent = await agentDefs.getById(id)
    if (agent.organizationId !== organizationId) return c.json({ error: 'not_found' }, 404)
    const files: AgentViewFile[] = []
    if (agent.instructions && agent.instructions.trim().length > 0) {
      files.push({ path: '/AGENTS.md', title: 'AGENTS.md', content: agent.instructions })
    }
    if (agent.workingMemory && agent.workingMemory.trim().length > 0) {
      files.push({ path: '/MEMORY.md', title: 'MEMORY.md', content: agent.workingMemory })
    }
    // The agent's runtime skill set is the union of file-based allowlist
    // entries and DB-backed learned-skills rows; both surface as
    // `/skills/<name>.md` files. We deduplicate by name (a learned-skills
    // row with the same name shadows the file-based placeholder).
    const skills = await listSkillsForAgent({ organizationId, agentId: id })
    const skillsByName = new Map(skills.map((s) => [s.name, s]))
    const seen = new Set<string>()
    for (const name of agent.skillAllowlist ?? []) {
      seen.add(name)
      const skill = skillsByName.get(name)
      files.push({
        path: `/skills/${name}.md`,
        title: `skills/${name}.md`,
        content: skill
          ? skill.body || `Skill "${name}" — empty body.`
          : `Skill "${name}" is allow-listed for this agent. Source body ships via \`vobase install --defaults\` (modules/<m>/defaults/<name>.skill.md).`,
      })
    }
    for (const skill of skills) {
      if (seen.has(skill.name)) continue
      files.push({
        path: `/skills/${skill.name}.md`,
        title: `skills/${skill.name}.md`,
        content: skill.body || `Skill "${skill.name}" — empty body.`,
      })
    }
    await collectAgentDriveFiles(organizationId, id, files)
    return c.json({ scope: `/agents/${id}`, files } satisfies AgentViewResponse)
  } catch {
    return c.json({ error: 'not_found' }, 404)
  }
})

/**
 * Walks the agent's drive scope depth-first, appending real (non-virtual)
 * file rows with non-empty extracted text. Folders are descended into but
 * not surfaced as their own entries.
 */
async function collectAgentDriveFiles(organizationId: string, agentId: string, out: AgentViewFile[]): Promise<void> {
  const drive = filesServiceFor(organizationId)
  const scope = { scope: 'agent' as const, agentId }

  async function walk(parentId: string | null): Promise<void> {
    const rows = await drive.listFolder(scope, parentId)
    for (const row of rows) {
      if (isVirtualOverlay(row)) continue
      if (row.kind === 'folder') {
        await walk(row.id)
        continue
      }
      const content = row.extractedText ?? ''
      if (content.length === 0) continue
      out.push({ path: row.path, title: row.path.replace(/^\//, ''), content })
    }
  }

  await walk(null)
}

function isVirtualOverlay(row: DriveFile): boolean {
  return row.id.startsWith('virtual:')
}

export default app
