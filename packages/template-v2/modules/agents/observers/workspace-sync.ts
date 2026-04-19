/**
 * workspaceSyncObserver — on `agent_end`, flushes the dirty-tracker buffer and
 * persists writable-zone changes to their owning module services.
 *
 * Routing rules:
 *   `/workspace/contact/MEMORY.md` → ContactsPort.upsertWorkingMemorySection (section-ops)
 *   `/workspace/contact/drive/**`  → DrivePort.create / delete  (scope='contact')
 *
 * Frozen-snapshot invariant: this observer ONLY fires on `agent_end`.
 * Mid-wake dirty writes accumulate in the tracker but are NOT flushed until then,
 * so the current turn's frozen side-load never sees its own writes.
 *
 * Factory pattern: the harness injects the `IFileSystem` and `DirtyTracker`
 * instances (created at wake-start) so the observer has zero module-level state.
 */

import type { CreateFileInput, DriveScope } from '@server/contracts/drive-port'
import type { AgentEvent } from '@server/contracts/event'
import type { AgentObserver, ObserverContext } from '@server/contracts/observer'
import type { DirtyTracker } from '@server/workspace/dirty-tracker'
import type { IFileSystem } from 'just-bash'

export interface WorkspaceSyncOpts {
  fs: IFileSystem
  tracker: DirtyTracker
  contactId: string
}

export function createWorkspaceSyncObserver(opts: WorkspaceSyncOpts): AgentObserver {
  const { fs, tracker, contactId } = opts

  return {
    id: 'agents:workspace-sync',

    async handle(event: AgentEvent, ctx: ObserverContext): Promise<void> {
      if (event.type !== 'agent_end') return

      const scoped = await tracker.flush(fs)

      // ── 1. Contact MEMORY.md → section upserts ──────────────────────────
      const memoryDirty = scoped.contactMemory.added.length > 0 || scoped.contactMemory.changed.length > 0

      if (memoryDirty) {
        try {
          const raw = await fs.readFile('/workspace/contact/MEMORY.md')
          const sections = parseMarkdownSections(raw)
          for (const [heading, body] of sections) {
            await ctx.ports.contacts.upsertWorkingMemorySection(contactId, heading, body)
          }
        } catch (err) {
          ctx.logger.warn({ err }, 'workspace-sync: failed to flush contact/MEMORY.md')
        }
      }

      // ── 2. Contact drive → DrivePort (scope='contact') ──────────────────
      const contactScope: DriveScope = { scope: 'contact', contactId }

      const toWrite = [...scoped.contactDrive.added, ...scoped.contactDrive.changed]
      for (const wPath of toWrite) {
        try {
          const content = await fs.readFile(wPath)
          // Convert workspace path → scope-relative path
          const drivePath = wPath.slice('/workspace/contact/drive'.length) || '/'
          const name = drivePath.split('/').filter(Boolean).pop() ?? drivePath

          const existing = await ctx.ports.drive.getByPath(contactScope, drivePath)
          if (!existing) {
            const input: CreateFileInput = {
              kind: 'file',
              name,
              path: drivePath,
              mimeType: 'text/markdown',
              extractedText: content,
              source: 'agent_uploaded',
            }
            await ctx.ports.drive.create(contactScope, input)
          }
          // Content updates on existing files are deferred to Phase 3 (no update-content on DrivePort yet).
        } catch (err) {
          ctx.logger.warn({ err, wPath }, 'workspace-sync: failed to persist contact/drive file')
        }
      }

      for (const wPath of scoped.contactDrive.deleted) {
        try {
          const drivePath = wPath.slice('/workspace/contact/drive'.length) || '/'
          const existing = await ctx.ports.drive.getByPath(contactScope, drivePath)
          if (existing) {
            await ctx.ports.drive.delete(existing.id)
          }
        } catch (err) {
          ctx.logger.warn({ err, wPath }, 'workspace-sync: failed to delete contact/drive file')
        }
      }
    },
  }
}

/** Split raw markdown by `##` headings → `[[heading, body], …]`. */
function parseMarkdownSections(md: string): Array<[string, string]> {
  const sections: Array<[string, string]> = []
  const lines = md.split('\n')
  let heading: string | null = null
  const body: string[] = []

  function flush() {
    if (heading !== null) {
      sections.push([heading, body.join('\n').trim()])
      body.length = 0
    }
  }

  for (const line of lines) {
    const m = line.match(/^##\s+(.+)/)
    if (m) {
      flush()
      heading = m[1].trim()
    } else if (heading !== null) {
      body.push(line)
    }
  }
  flush()
  return sections
}
