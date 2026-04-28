/**
 * Drive overlay provider for the `team/staff-cross-agent-memory` virtual subtree.
 *
 * Contributes to the `staff` drive scope:
 *   - `/agents/` folder (synthetic, at root parentId=null) — present only when
 *     at least one `agent_staff_memory` row exists for this staff member.
 *   - `/agents/<agentName>/` folder (per agent that has a memory row)
 *   - `/agents/<agentName>/MEMORY.md` file (the memory blob)
 *
 * Virtual id format (via formatProviderId):
 *   `virtual:provider:team/staff-cross-agent-memory:<staffId>:agents-dir`
 *   `virtual:provider:team/staff-cross-agent-memory:<staffId>:agent:<agentId>`
 *   `virtual:provider:team/staff-cross-agent-memory:<staffId>:leaf:<agentId>`
 *
 * Cross-org isolation: `listStaffMemoryByStaff` already filters by
 * `organizationId`. Every path in this provider passes `ctx.organizationId`
 * directly — returning another org's data is Sev-1.
 */

import { listStaffMemoryByStaff } from '@modules/agents/service/staff-memory'
import type { DriveFile } from '@modules/drive/schema'
import {
  type DriveOverlayContext,
  type DriveOverlayProvider,
  type DriveOverlayReadContext,
  makeProviderRow,
} from '@modules/drive/service/overlays'
import { formatProviderId } from '@modules/drive/service/virtual-ids'

export const STAFF_MEMORY_PROVIDER_ID = 'team/staff-cross-agent-memory'

const AGENTS_DIR_PATH = '/agents'
const AGENTS_DIR_NAME = 'agents'

function agentsFolderDirId(staffId: string): string {
  return formatProviderId(STAFF_MEMORY_PROVIDER_ID, staffId, 'agents-dir')
}

function agentFolderId(staffId: string, agentId: string): string {
  return formatProviderId(STAFF_MEMORY_PROVIDER_ID, staffId, `agent:${agentId}`)
}

function makeAgentsDirRow(organizationId: string, staffId: string, updatedAt: Date): DriveFile {
  return makeProviderRow({
    kind: 'folder',
    providerId: STAFF_MEMORY_PROVIDER_ID,
    scope: 'staff',
    scopeId: staffId,
    organizationId,
    parentFolderId: null,
    name: AGENTS_DIR_NAME,
    path: AGENTS_DIR_PATH,
    key: 'agents-dir',
    updatedAt,
  })
}

function makeAgentFolderRow(
  organizationId: string,
  staffId: string,
  agentId: string,
  agentName: string,
  updatedAt: Date,
): DriveFile {
  return makeProviderRow({
    kind: 'folder',
    providerId: STAFF_MEMORY_PROVIDER_ID,
    scope: 'staff',
    scopeId: staffId,
    organizationId,
    parentFolderId: agentsFolderDirId(staffId),
    name: agentName,
    path: `${AGENTS_DIR_PATH}/${agentName}`,
    key: `agent:${agentId}`,
    updatedAt,
  })
}

function makeMemoryLeafRow(
  organizationId: string,
  staffId: string,
  agentId: string,
  agentName: string,
  updatedAt: Date,
): DriveFile {
  return makeProviderRow({
    kind: 'file',
    providerId: STAFF_MEMORY_PROVIDER_ID,
    scope: 'staff',
    scopeId: staffId,
    organizationId,
    parentFolderId: agentFolderId(staffId, agentId),
    name: 'MEMORY.md',
    path: `${AGENTS_DIR_PATH}/${agentName}/MEMORY.md`,
    key: `leaf:${agentId}`,
    updatedAt,
  })
}

export const staffCrossAgentMemoryOverlay: DriveOverlayProvider = {
  id: STAFF_MEMORY_PROVIDER_ID,
  appliesTo: ['staff'],

  async list(ctx: DriveOverlayContext): Promise<DriveFile[]> {
    if (ctx.scope.scope !== 'staff') return []
    const staffId = ctx.scope.userId
    const { organizationId } = ctx

    const entries = await listStaffMemoryByStaff({ organizationId, staffId })

    if (ctx.parentId === null) {
      if (entries.length === 0) return []
      // Folder timestamp = max child updatedAt so the parent rolls up "latest activity".
      const maxUpdatedAt = entries.reduce<Date>(
        (acc, e) => (e.updatedAt && e.updatedAt > acc ? e.updatedAt : acc),
        new Date(0),
      )
      return [makeAgentsDirRow(organizationId, staffId, maxUpdatedAt)]
    }

    const agentsDirId = agentsFolderDirId(staffId)
    if (ctx.parentId === agentsDirId) {
      return entries.map((e) =>
        makeAgentFolderRow(organizationId, staffId, e.agentId, e.agentName, e.updatedAt ?? new Date(0)),
      )
    }

    // Per-agent folder listing: emit MEMORY.md leaf
    for (const e of entries) {
      if (ctx.parentId === agentFolderId(staffId, e.agentId)) {
        return [makeMemoryLeafRow(organizationId, staffId, e.agentId, e.agentName, e.updatedAt ?? new Date(0))]
      }
    }

    return []
  },

  async read(ctx: DriveOverlayReadContext): Promise<{ content: string; updatedAt?: Date } | null> {
    if (ctx.scope.scope !== 'staff') return null
    const staffId = ctx.scope.userId
    const { organizationId, path } = ctx

    // Match /agents/<agentName>/MEMORY.md
    const match = path.match(/^\/agents\/([^/]+)\/MEMORY\.md$/)
    if (!match) return null
    const agentName = match[1]

    const entries = await listStaffMemoryByStaff({ organizationId, staffId })
    const entry = entries.find((e) => e.agentName === agentName)
    if (!entry) return null

    return { content: entry.memory, updatedAt: entry.updatedAt }
  },
}
