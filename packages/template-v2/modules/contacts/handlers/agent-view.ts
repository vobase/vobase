/**
 * GET /api/contacts/:id/agent-view — returns the materialized files an
 * agent sees for this contact: the virtual `profile.md` + `MEMORY.md` (notes)
 * pair AND any real drive files persisted under `scope='contact', scope_id=:id`
 * (drive_doc proposals approved through the changes umbrella write here).
 *
 * Same response shape as the agent and staff views so `<AgentViewPane>` is
 * uniform.
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import * as contactsSvc from '@modules/contacts/service/contacts'
import type { DriveFile } from '@modules/drive/schema'
import { filesServiceFor } from '@modules/drive/service/files'
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
    await collectContactDriveFiles(organizationId, id, files)
    return c.json({ scope: `/contacts/${id}`, files } satisfies AgentViewResponse)
  } catch {
    return c.json({ error: 'not_found' }, 404)
  }
})

/**
 * Walks the contact's drive scope depth-first, appending real (non-virtual)
 * file rows with non-empty extracted text. Folders are descended into but not
 * surfaced as their own entries — the agent-view pane is a flat file list.
 */
async function collectContactDriveFiles(
  organizationId: string,
  contactId: string,
  out: AgentViewFile[],
): Promise<void> {
  const drive = filesServiceFor(organizationId)
  const scope = { scope: 'contact' as const, contactId }
  await walk(null)

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
}

function isVirtualOverlay(row: DriveFile): boolean {
  return row.id.startsWith('virtual:')
}

export default app
