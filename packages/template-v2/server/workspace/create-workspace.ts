/**
 * Template wrapper around `@vobase/core#createWorkspace`.
 *
 * Core owns the domain-free workspace assembly (frozen materializer render,
 * snapshot capture, lazy on-read wiring, bash exec wrapping). This template
 * entry point adds the helpdesk-specific bits the factory can't know about:
 *   - Eager `/drive/**` and `/contacts/<id>/drive/**` file mounts (recursive).
 *   - Writable-zone directory creation (`/tmp`, `/contacts/<id>/drive`,
 *     `/agents/<id>/skills`, `/staff/<id>`).
 *   - The `vobase` subcommand dispatcher.
 *
 * Drive content is pre-fetched outside the just-bash sandbox because the
 * sandbox blocks `setImmediate` (used by the postgres driver), which would
 * crash any lazy reader triggered mid-`cat`. This is also more aligned with
 * frozen-snapshot semantics — drive content is pinned per wake.
 *
 * The materializers themselves (AGENTS.md, BUSINESS.md, profile.md, MEMORY.md,
 * messages.md, internal-notes.md, staff/*) are now module-owned — callers pass
 * them in via `opts.materializers`.
 */

import type { AgentDefinition } from '@modules/agents/schema'
import type { DriveFile } from '@modules/drive/schema'
import type { FilesService } from '@modules/drive/service/files'
import type { CommandContext, CommandDef } from '@server/common/port-types'
import {
  type WorkspaceHandle as CoreWorkspaceHandle,
  createWorkspace as coreCreateWorkspace,
  type MaterializerCtx,
  type ReadOnlyConfig,
  type WorkspaceMaterializer,
} from '@vobase/core'

import { createVobaseCommand } from './vobase-cli/dispatcher'

export interface CreateWorkspaceOpts {
  organizationId: string
  agentId: string
  contactId: string
  conversationId: string
  channelInstanceId: string
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

export async function createWorkspace(opts: CreateWorkspaceOpts): Promise<WorkspaceHandle> {
  const ctx: MaterializerCtx = {
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    conversationId: opts.conversationId,
    contactId: opts.contactId,
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
  const contactPrefix = `/contacts/${opts.contactId}`
  const contactChannelPrefix = `${contactPrefix}/${opts.channelInstanceId}`

  // Ensure writable top-level dirs exist so `ls` lists them.
  await innerFs.mkdir('/tmp', { recursive: true })
  await innerFs.mkdir(`${contactPrefix}/drive`, { recursive: true })
  await innerFs.mkdir(contactChannelPrefix, { recursive: true })
  await innerFs.mkdir(`${agentPrefix}/skills`, { recursive: true })

  // Staff dirs — discovered from the frozen materializer paths that got
  // rendered above (`/staff/<id>/(profile.md|MEMORY.md)`).
  const seenStaffIds = new Set<string>()
  for (const m of opts.materializers) {
    const match = m.path.match(/^\/staff\/([^/]+)\//)
    if (match) seenStaffIds.add(match[1])
  }
  for (const staffId of seenStaffIds) {
    await innerFs.mkdir(`/staff/${staffId}`, { recursive: true })
  }

  const [tenantFiles, contactFiles] = await Promise.all([
    listAllFiles(opts.drivePort, { scope: 'organization' }),
    listAllFiles(opts.drivePort, { scope: 'contact', contactId: opts.contactId }),
  ])

  await Promise.all([
    ...tenantFiles
      // BUSINESS.md is rendered by the drive materializer; skip it here so we
      // don't double-write and clobber the materializer's output.
      .filter((f) => `/drive${f.path}` !== '/drive/BUSINESS.md')
      .map(async (file) => {
        const body = await opts.drivePort.readContent(file.id).catch(() => null)
        if (body) await innerFs.writeFile(`/drive${file.path}`, body.content)
      }),
    ...contactFiles.map(async (file) => {
      const body = await opts.drivePort.readContent(file.id).catch(() => null)
      if (body) await innerFs.writeFile(`${contactPrefix}/drive${file.path}`, body.content)
    }),
  ])

  return handle
}

/** Recursively walk a drive scope and return every file (folders excluded). */
async function listAllFiles(
  drive: FilesService,
  scope: Parameters<FilesService['listFolder']>[0],
): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  const stack: (string | null)[] = [null]
  while (stack.length > 0) {
    const parentId = stack.pop() ?? null
    const entries = await drive.listFolder(scope, parentId).catch(() => [])
    for (const entry of entries) {
      if (entry.kind === 'folder') stack.push(entry.id)
      else out.push(entry)
    }
  }
  return out
}
