/**
 * createWorkspaceSyncListener — on `agent_end`, flushes the dirty-tracker
 * buffer and persists writable-zone changes to their owning module services.
 *
 * Routing rules:
 *   `/agents/<id>/MEMORY.md`      → drive.writePath({scope:'agent'})  (virtual column on agent_definitions)
 *   `/contacts/<id>/MEMORY.md`    → drive.writePath({scope:'contact'}) (virtual column on contacts)
 *   `/contacts/<id>/drive/**`     → FilesService.create / delete  (scope='contact')
 *   `/staff/<staffId>/MEMORY.md`  → upsertStaffMemory(org, agent, staff)
 *
 * Agent + contact memory go through `drive.writePath` so the wholesale file
 * body lands on the backing column atomically. The earlier section-parser
 * approach required `## Heading` blocks and dropped plain-paragraph appends
 * silently.
 *
 * Frozen-snapshot invariant: this listener ONLY fires on `agent_end`.
 * Mid-wake dirty writes accumulate in the tracker but are NOT flushed until then,
 * so the current turn's frozen side-load never sees its own writes.
 *
 * Factory pattern: the harness injects the `IFileSystem` and `DirtyTracker`
 * instances (created at wake-start) so the listener has zero module-level state.
 */

import { upsertStaffMemory } from '@modules/agents/service/staff-memory'
import type { FilesService } from '@modules/drive/service/files'
import type { CreateFileInput, DriveScope } from '@modules/drive/service/types'
import type { DirtyTracker, HarnessLogger } from '@vobase/core'
import type { IFileSystem } from 'just-bash'

import type { RealtimeService } from '~/runtime'
import type { AgentEvent } from '../events'

export interface WorkspaceSyncOpts {
  fs: IFileSystem
  tracker: DirtyTracker
  organizationId: string
  agentId: string
  contactId: string
  drive: FilesService
  logger: HarnessLogger
  /**
   * Realtime broadcast for memory updates. After persisting agent / contact
   * MEMORY.md the listener fires `pg_notify` so the frontend's Memory panel
   * (and the Drive browser preview) refresh without a manual reload. Optional
   * because some tests don't exercise the realtime path.
   */
  realtime?: RealtimeService | null
}

export function createWorkspaceSyncListener(opts: WorkspaceSyncOpts): (event: AgentEvent) => Promise<void> {
  const { fs, tracker, organizationId, agentId, contactId, drive, logger, realtime } = opts

  return async (event: AgentEvent): Promise<void> => {
    if (event.type !== 'agent_end') return

    const scoped = await tracker.flush(fs)

    // ── 0. Staff MEMORY.md → agent_staff_memory upserts ────────────────
    for (const [staffId, diff] of scoped.staffMemory) {
      const dirty = diff.added.length > 0 || diff.changed.length > 0
      if (!dirty) continue
      try {
        const content = await fs.readFile(`/staff/${staffId}/MEMORY.md`)
        await upsertStaffMemory({ organizationId, agentId, staffId }, content)
      } catch (err) {
        logger.warn({ err, staffId }, 'workspace-sync: failed to flush staff MEMORY.md')
      }
    }

    // ── 1a. Agent MEMORY.md → agent_definitions.working_memory ──────────
    const agentMemoryDirty = scoped.agentMemory.added.length > 0 || scoped.agentMemory.changed.length > 0
    if (agentMemoryDirty) {
      const agentMemoryPath = `/agents/${agentId}/MEMORY.md`
      try {
        const content = await fs.readFile(agentMemoryPath)
        await drive.writePath({ scope: 'agent', agentId }, '/MEMORY.md', content)
        logger.info({ agentId, bytes: content.length }, 'workspace-sync: persisted agent MEMORY.md')
        try {
          realtime?.notify({ table: 'agent_definitions', id: agentId, action: 'memory_updated' })
        } catch {
          // notify is best-effort — frontend will still refresh on the next manual fetch.
        }
      } catch (err) {
        logger.warn({ err, agentId }, 'workspace-sync: failed to flush agent MEMORY.md')
      }
    }

    // ── 1b. Contact MEMORY.md → contacts.memory column ──────────────────
    const contactMemoryDirty = scoped.contactMemory.added.length > 0 || scoped.contactMemory.changed.length > 0

    const contactDrivePrefix = `/contacts/${contactId}/drive`
    const contactMemoryPath = `/contacts/${contactId}/MEMORY.md`

    if (contactMemoryDirty) {
      try {
        const content = await fs.readFile(contactMemoryPath)
        await drive.writePath({ scope: 'contact', contactId }, '/MEMORY.md', content)
        logger.info({ contactId, bytes: content.length }, 'workspace-sync: persisted contact MEMORY.md')
        try {
          realtime?.notify({ table: 'contacts', id: contactId, action: 'memory_updated' })
        } catch {
          // notify is best-effort.
        }
      } catch (err) {
        logger.warn({ err, contactId }, 'workspace-sync: failed to flush contact MEMORY.md')
      }
    }

    // ── 2. Contact drive → FilesService (scope='contact') ──────────────────
    const contactScope: DriveScope = { scope: 'contact', contactId }

    const toWrite = [...scoped.contactDrive.added, ...scoped.contactDrive.changed]
    for (const wPath of toWrite) {
      try {
        const content = await fs.readFile(wPath)
        // Convert workspace path → scope-relative path
        const drivePath = wPath.slice(contactDrivePrefix.length) || '/'
        const name = drivePath.split('/').filter(Boolean).pop() ?? drivePath

        const existing = await drive.getByPath(contactScope, drivePath)
        if (!existing) {
          const input: CreateFileInput = {
            kind: 'file',
            name,
            path: drivePath,
            mimeType: 'text/markdown',
            extractedText: content,
            source: 'agent_uploaded',
          }
          await drive.create(contactScope, input)
        }
        // Content updates on existing files are deferred to Phase 3 (no update-content on FilesService yet).
      } catch (err) {
        logger.warn({ err, wPath }, 'workspace-sync: failed to persist contact drive file')
      }
    }

    for (const wPath of scoped.contactDrive.deleted) {
      try {
        const drivePath = wPath.slice(contactDrivePrefix.length) || '/'
        const existing = await drive.getByPath(contactScope, drivePath)
        if (existing) {
          await drive.remove(existing.id)
        }
      } catch (err) {
        logger.warn({ err, wPath }, 'workspace-sync: failed to delete contact drive file')
      }
    }
  }
}
