/**
 * Operator-flavoured wrapper around `@vobase/core#createWorkspace`. Operator
 * wakes are NOT conversation-bound, so unlike `createWorkspace` (which
 * mounts contact-scoped paths and pre-fetches contact drive content), this
 * builder only sets up the org-wide spine: `/tmp`, `/agents/<id>/skills`,
 * `/staff/<id>/`, and the global `/drive/**` mount.
 *
 * The synthetic `conversationId` (e.g. `operator-<threadId>`) is required by
 * the harness contract but unused for path construction — it appears only in
 * journal events. `contactId` is empty by design; downstream code that
 * interpolates it must skip operator wakes (or accept that operator-scoped
 * `/contacts/<empty>/...` paths are nonsensical and not produced here).
 */

import type { AgentDefinition } from '@modules/agents/schema'
import type { FilesService } from '@modules/drive/service/files'
import {
  type WorkspaceHandle as CoreWorkspaceHandle,
  createWorkspace as coreCreateWorkspace,
  type MaterializerCtx,
  type ReadOnlyConfig,
  type WorkspaceMaterializer,
} from '@vobase/core'

import type { CommandContext, CommandDef } from '~/runtime'
import { createVobaseCommand } from './cli/dispatcher'
import { listAllDriveFiles } from './list-drive-files'

export interface CreateOperatorWorkspaceOpts {
  organizationId: string
  agentId: string
  /**
   * Synthetic id used by the journal — `operator-<threadId>` for thread
   * wakes, `heartbeat-<scheduleId>` for cron wakes. Builders set this; the
   * workspace just passes it through to `MaterializerCtx`.
   */
  conversationId: string
  wakeId: string
  agentDefinition: AgentDefinition
  commandCtx?: Partial<CommandContext>
  commands: readonly CommandDef[]
  materializers: readonly WorkspaceMaterializer[]
  drivePort: FilesService
  onSideEffect?: (cmd: CommandDef) => void
  env?: Record<string, string>
  readOnlyConfig: ReadOnlyConfig
}

export type WorkspaceHandle = CoreWorkspaceHandle

export async function createOperatorWorkspace(opts: CreateOperatorWorkspaceOpts): Promise<WorkspaceHandle> {
  const ctx: MaterializerCtx = {
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    conversationId: opts.conversationId,
    contactId: '',
    turnIndex: 0,
  }

  const handle = await coreCreateWorkspace({
    materializers: opts.materializers,
    readOnlyConfig: opts.readOnlyConfig,
    ctx,
    commands: opts.commands,
    commandCtx: opts.commandCtx,
    onSideEffect: opts.onSideEffect,
    env: opts.env,
    cwd: `/agents/${opts.agentId}`,
    buildVobaseCommand: ({ commands, ctx: cmdCtx, onSideEffect }) =>
      createVobaseCommand({ commands, ctx: cmdCtx, onSideEffect }),
  })

  const { innerFs } = handle
  const agentPrefix = `/agents/${opts.agentId}`

  await innerFs.mkdir('/tmp', { recursive: true })
  await innerFs.mkdir(`${agentPrefix}/skills`, { recursive: true })

  // Discover staff dirs from the frozen materializer paths so `ls /staff/`
  // lists them. Same trick as `createWorkspace`.
  const seenStaffIds = new Set<string>()
  for (const m of opts.materializers) {
    const match = m.path.match(/^\/staff\/([^/]+)\//)
    if (match) seenStaffIds.add(match[1])
  }
  for (const staffId of seenStaffIds) {
    await innerFs.mkdir(`/staff/${staffId}`, { recursive: true })
  }

  // Global drive mount only. Contact-scoped drive doesn't make sense for an
  // operator wake — they survey across all contacts.
  const tenantFiles = await listAllDriveFiles(opts.drivePort, { scope: 'organization' })
  await Promise.all(
    tenantFiles
      .filter((f) => `/drive${f.path}` !== '/drive/BUSINESS.md')
      .map(async (file) => {
        const body = await opts.drivePort.readContent(file.id).catch(() => null)
        if (body) await innerFs.writeFile(`/drive${file.path}`, body.content)
      }),
  )

  return handle
}
