/**
 * `GET /api/agents/workspace/tree` — materializes the workspace virtual
 * filesystem path list for the Workspace surface (§9 of the dual-surface
 * change). The frontend (`<FileTree>` from `@pierre/trees`) renders this as
 * a navigable tree.
 *
 * `GET /api/agents/workspace/file?path=...` — reads the markdown / yaml
 * content for a single path so the workspace's middle pane can render it.
 * Resolves paths against the same conventions the tree uses.
 *
 * Path conventions:
 *   - `/agents/<id>/AGENTS.md`, `/agents/<id>/MEMORY.md`
 *   - `/contacts/<id>/profile.md`, `/contacts/<id>/MEMORY.md`
 *   - `/drive/<path>` for every drive file
 *   - `/views/<scope>/<slug>.view.yaml`
 *   - `/workspace/schedules/<id>` (synthetic — not a real materializer)
 *   - `/workspace/chats/<threadId>` (synthetic — `agent_threads`)
 *   - `/INDEX.md` (always)
 *
 * Paths cap at `MAX_PATHS` (default 500) so a project with many drive files
 * doesn't blow up the tree. The frontend switches to `prepareFileTreeInput()`
 * mode when it sees the `truncated: true` flag.
 */

import type { SessionEnv } from '@auth/middleware/require-session'
import { getById as getAgentDefinition, list as listAgentDefinitions } from '@modules/agents/service/agent-definitions'
import { threads as threadsApi } from '@modules/agents/service/threads'
import { buildIndexFileMaterializer } from '@modules/agents/wake/build-config/base'
import {
  conversationVerbs,
  driveVerbs,
  generateAgentsMd,
  HELPDESK_AGENTS_MD_HEADER,
  teamVerbs,
} from '@modules/agents/workspace'
import type { Contact } from '@modules/contacts/schema'
import { get as getContact, list as listContacts } from '@modules/contacts/service/contacts'
import { schedules as schedulesApi } from '@modules/schedules/service/schedules'
import { get as getSavedView, list as listSavedViews } from '@modules/views/service/views'
import { serializeYaml } from '@vobase/core'
import { Hono } from 'hono'
import { z } from 'zod'

const MAX_PATHS = 500

export const WorkspaceTreeResponseSchema = z.object({
  paths: z.array(z.string()),
  truncated: z.boolean(),
  total: z.number(),
})

export type WorkspaceTreeResponse = z.infer<typeof WorkspaceTreeResponseSchema>

export const WorkspaceFileResponseSchema = z.object({
  path: z.string(),
  content: z.string(),
})

export type WorkspaceFileResponse = z.infer<typeof WorkspaceFileResponseSchema>

const app = new Hono<SessionEnv>()
  .get('/workspace/tree', async (c) => {
    const session = c.get('session')
    const organizationId = c.req.query('organizationId')
    if (!organizationId) {
      return c.json({ paths: [], truncated: false, total: 0 } satisfies WorkspaceTreeResponse)
    }
    const userId = session.user.id

    const paths: string[] = ['/INDEX.md']

    const [agents, contacts, schedules, savedViews, chatThreads] = await Promise.all([
      listAgentDefinitions(organizationId).catch(() => []),
      listContacts(organizationId).catch(() => []),
      schedulesApi.listEnabled({ organizationId }).catch(() => []),
      listSavedViews('object:contacts').catch(() => []),
      threadsApi.listForCreator({ organizationId, createdBy: userId, limit: 50 }).catch(() => []),
    ])

    for (const a of agents) {
      paths.push(`/agents/${a.id}/AGENTS.md`)
      paths.push(`/agents/${a.id}/MEMORY.md`)
    }

    for (const c of contacts) {
      paths.push(`/contacts/${c.id}/profile.md`)
      paths.push(`/contacts/${c.id}/MEMORY.md`)
    }

    for (const v of savedViews) {
      paths.push(`/views/${v.scope ?? 'object:contacts'}/${v.slug}.view.yaml`)
    }

    for (const s of schedules) {
      paths.push(`/workspace/schedules/${s.id}`)
    }

    for (const t of chatThreads) {
      paths.push(`/workspace/chats/${t.id}`)
    }

    const total = paths.length
    const truncated = total > MAX_PATHS
    return c.json({
      paths: truncated ? paths.slice(0, MAX_PATHS) : paths,
      truncated,
      total,
    } satisfies WorkspaceTreeResponse)
  })
  .get('/workspace/file', async (c) => {
    const path = c.req.query('path') ?? ''
    const organizationId = c.req.query('organizationId') ?? ''
    if (!path || !organizationId) return c.json({ error: 'path_and_org_required' }, 400)

    const content = await readWorkspaceFile(path, organizationId)
    if (content === null) return c.json({ error: 'not_supported_for_path' }, 404)
    return c.json({ path, content } satisfies WorkspaceFileResponse)
  })

async function readWorkspaceFile(path: string, organizationId: string): Promise<string | null> {
  if (path === '/INDEX.md') {
    const m = buildIndexFileMaterializer({ organizationId })
    return m.materialize({} as Parameters<typeof m.materialize>[0])
  }

  const agentMatch = /^\/agents\/([^/]+)\/(AGENTS|MEMORY)\.md$/.exec(path)
  if (agentMatch) {
    const [, id, kind] = agentMatch
    const def = await getAgentDefinition(id).catch(() => null)
    if (!def) return null
    if (kind === 'MEMORY') return def.workingMemory || '_No working memory yet._\n'
    return generateAgentsMd({
      agentName: def.name,
      agentId: def.id,
      commands: [...teamVerbs, ...conversationVerbs, ...driveVerbs],
      instructions: def.instructions,
      headerOverride: HELPDESK_AGENTS_MD_HEADER,
    })
  }

  const contactMatch = /^\/contacts\/([^/]+)\/(profile|MEMORY)\.md$/.exec(path)
  if (contactMatch) {
    const [, id, kind] = contactMatch
    const contact = await getContact(id).catch(() => null)
    if (!contact) return null
    if (kind === 'MEMORY') return contact.notes || '_No agent notes yet._\n'
    return renderContactProfile(contact)
  }

  const viewMatch = /^\/views\/([^/]+)\/([^/]+)\.view\.yaml$/.exec(path)
  if (viewMatch) {
    const [, scope, slug] = viewMatch
    const row = await getSavedView(slug, scope).catch(() => null)
    if (!row) return null
    return `# origin: ${row.origin}${row.fileSourcePath ? ` (source: ${row.fileSourcePath})` : ''}\n${serializeYaml(row.body)}`
  }

  return null
}

function renderContactProfile(contact: Contact): string {
  const lines: string[] = []
  lines.push(`# ${contact.displayName ?? 'Untitled contact'}`)
  if (contact.email) lines.push(`- email: ${contact.email}`)
  if (contact.phone) lines.push(`- phone: ${contact.phone}`)
  if (contact.segments.length) lines.push(`- segments: ${contact.segments.join(', ')}`)
  lines.push('')
  lines.push(contact.profile || '_No profile authored yet._')
  return `${lines.join('\n')}\n`
}

export default app
