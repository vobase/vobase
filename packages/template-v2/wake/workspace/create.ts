/**
 * Template wrapper around `@vobase/core#createWorkspace`. Builds the
 * helpdesk-specific virtual filesystem for a wake — eager `/drive/**` mounts,
 * writable-zone directories (`/tmp`, `/agents/<id>/skills`, `/staff/<id>`),
 * and the `vobase` subcommand dispatcher backed by the shared CLI registry.
 *
 * Two lanes via the `lane` discriminator:
 *
 * - `'conversation'` — bound to a `(contactId, channelInstanceId)` pair. Mounts
 *   `/contacts/<id>/drive/**` recursively in addition to the global `/drive/**`.
 *
 * - `'standalone'` — operator-thread / heartbeat wakes. No contact context;
 *   only the global `/drive/**` mount.
 *
 * Drive content is pre-fetched outside the just-bash sandbox because the
 * sandbox blocks `setImmediate` (used by the postgres driver), which would
 * crash any lazy reader triggered mid-`cat`. This is also more aligned with
 * frozen-snapshot semantics — drive content is pinned per wake.
 */

import type { AgentDefinition } from '@modules/agents/schema'
import type { DriveFile } from '@modules/drive/schema'
import type { FilesService } from '@modules/drive/service/files'
import {
  type CliVerbRegistry,
  type WorkspaceHandle as CoreWorkspaceHandle,
  createWorkspace as coreCreateWorkspace,
  createBashVobaseCommand,
  type MaterializerCtx,
  type ReadOnlyConfig,
  type VerbContext,
  type WorkspaceMaterializer,
} from '@vobase/core'

export type WorkspaceLane = 'conversation' | 'standalone'

export interface CreateWorkspaceOpts {
  lane: WorkspaceLane
  organizationId: string
  agentId: string
  /** Required for `lane: 'conversation'`; empty string for `'standalone'`. */
  contactId: string
  conversationId: string
  /** Required for `lane: 'conversation'`; empty string for `'standalone'`. */
  channelInstanceId: string
  wakeId: string
  agentDefinition: AgentDefinition
  /** Verb catalog for the in-bash dispatcher. Same registry the runtime CLI binary uses. */
  registry: CliVerbRegistry
  materializers: readonly WorkspaceMaterializer[]
  drivePort: FilesService
  /** Fires once per non-read-only verb dispatched. Wake's "did-something" heuristic. */
  onSideEffect?: (verbName: string) => void
  env?: Record<string, string>
  readOnlyConfig: ReadOnlyConfig
}

export type WorkspaceHandle = CoreWorkspaceHandle

export async function createWorkspace(opts: CreateWorkspaceOpts): Promise<WorkspaceHandle> {
  const isConversation = opts.lane === 'conversation'

  const ctx: MaterializerCtx = {
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    conversationId: opts.conversationId,
    contactId: isConversation ? opts.contactId : '',
    turnIndex: 0,
  }

  const verbContext: VerbContext = {
    organizationId: opts.organizationId,
    principal: { kind: 'agent', id: opts.agentId },
    wake: {
      conversationId: opts.conversationId,
      contactId: isConversation ? opts.contactId : '',
      ...(isConversation ? { channelInstanceId: opts.channelInstanceId } : {}),
      wakeId: opts.wakeId,
      turnIndex: 0,
    },
  }

  const handle = await coreCreateWorkspace({
    materializers: opts.materializers,
    readOnlyConfig: opts.readOnlyConfig,
    ctx,
    env: opts.env,
    cwd: `/agents/${opts.agentId}`,
    buildVobaseCommand: () =>
      createBashVobaseCommand({
        registry: opts.registry,
        context: verbContext,
        onSideEffect: opts.onSideEffect,
      }),
  })

  const { innerFs } = handle
  const agentPrefix = `/agents/${opts.agentId}`

  await innerFs.mkdir('/tmp', { recursive: true })
  await innerFs.mkdir(`${agentPrefix}/skills`, { recursive: true })

  if (isConversation) {
    const contactPrefix = `/contacts/${opts.contactId}`
    const contactChannelPrefix = `${contactPrefix}/${opts.channelInstanceId}`
    await innerFs.mkdir(`${contactPrefix}/drive`, { recursive: true })
    await innerFs.mkdir(contactChannelPrefix, { recursive: true })
  }

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

  // Global drive mount — both lanes get it.
  const tenantFiles = await listAllDriveFiles(opts.drivePort, { scope: 'organization' })
  const tenantWrites = tenantFiles
    // BUSINESS.md is rendered by the drive materializer; skip it here so we
    // don't double-write and clobber the materializer's output.
    .filter((f) => `/drive${f.path}` !== '/drive/BUSINESS.md')
    .map(async (file) => {
      const body = await opts.drivePort.readContent(file.id).catch(() => null)
      if (body) await innerFs.writeFile(`/drive${file.path}`, body.content)
    })

  // Contact drive mount — conversation lane only.
  const contactWrites: Promise<void>[] = []
  if (isConversation) {
    const contactPrefix = `/contacts/${opts.contactId}`
    const contactFiles = await listAllDriveFiles(opts.drivePort, { scope: 'contact', contactId: opts.contactId })
    for (const file of contactFiles) {
      contactWrites.push(
        (async () => {
          const body = await opts.drivePort.readContent(file.id).catch(() => null)
          if (body) await innerFs.writeFile(`${contactPrefix}/drive${file.path}`, body.content)
        })(),
      )
    }
  }

  await Promise.all([...tenantWrites, ...contactWrites])

  return handle
}

/**
 * Recursively walk a drive scope and return every file (folders excluded).
 * Private — both lanes consume it, but no external caller needs it.
 */
async function listAllDriveFiles(
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
