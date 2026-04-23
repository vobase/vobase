/**
 * Workspace factory.
 *
 * Assembles the `just-bash` `Bash` instance against an `InMemoryFs` wrapped in
 * `ScopedFs` (RO enforcer). Eager-writes the frozen-zone files at construction,
 * captures the `initialSnapshot` for the dirty-tracker, and registers lazy
 * materializers for `/drive/**`, `/contacts/<id>/drive/**`, and
 * `/agents/<id>/skills/**`.
 *
 * Principle: mid-wake writes persist to disk immediately but are invisible to
 * the current turn's frozen zone (frozen-snapshot invariant). Lazy paths that
 * are never `cat`ed stay out of the snapshot and so cannot register as "dirty".
 */

import type { AgentDefinition } from '@modules/agents/schema'
import type { AgentsPort } from '@modules/agents/service/types'
import type { ContactsService } from '@modules/contacts/service/contacts'
import type { DriveFile } from '@modules/drive/schema'
import type { FilesService } from '@modules/drive/service/files'
import type { CommandContext, CommandDef } from '@server/common/port-types'
import type { MaterializerCtx, WorkspaceMaterializer } from '@vobase/core'
import { generateAgentsMd, MaterializerRegistry, type ReadOnlyConfig, ScopedFs, snapshotFs } from '@vobase/core'
import { Bash, InMemoryFs } from 'just-bash'
import { createVobaseCommand } from './vobase-cli/dispatcher'
import type { WorkspacePath } from './workspace-config'

/** Built-in BUSINESS.md fallback stub — shown when no organization drive row exists. */
export const BUSINESS_MD_FALLBACK = `# Business Identity

No business profile configured. Ask staff to create /BUSINESS.md in the drive.
`

/** Built-in contact-profile fallback — first line carries identity (id as both name and parenthetical). */
function contactProfileFallback(contactId: string): string {
  return `# ${contactId} (${contactId})\n\n_No profile configured yet._\n`
}

const EMPTY_MESSAGES_MD = `# Conversation\n\n_No messages yet._\n`
const EMPTY_NOTES_MD = `# Internal Notes\n\n_No notes yet._\n`
const EMPTY_MEMORY_MD = `---
---

# Memory

_empty_
`

export interface CreateWorkspaceOpts {
  organizationId: string
  agentId: string
  contactId: string
  conversationId: string
  channelInstanceId: string
  wakeId: string
  /** The frozen-at-wake-start agent definition; supplies the instructions body + working memory. */
  agentDefinition: AgentDefinition
  /** Used by `CommandContext.writeWorkspace` and `readWorkspace`. */
  commandCtx?: Partial<CommandContext>
  /** Aggregated from every module's `registerCommand(...)`. */
  commands: readonly CommandDef[]
  /** Aggregated from every module's `registerWorkspaceMaterializer(...)`. */
  materializers: readonly WorkspaceMaterializer[]
  /** Cross-module ports — harness injects the real ones; tests can pass stubs. */
  drivePort: FilesService
  contactsPort: ContactsService
  agentsPort: AgentsPort
  /** Side-effect callback; fires once per non-read-only vobase subcommand. */
  onSideEffect?: (cmd: CommandDef) => void
  /** Optional env passed through to `Bash`. */
  env?: Record<string, string>
  /**
   * Paths to eagerly materialize at wake turn-0. Default is the list produced by
   * `buildFrozenEagerPaths({ agentId, contactId, conversationId })`; later phases
   * source this from merged module manifests.
   */
  frozenEagerPaths?: readonly WorkspacePath[]
  /**
   * Effective RO/writable configuration for `ScopedFs`. Required — template
   * declares its writable zones (drive uploads, scratch tmp) since core no
   * longer ships a default writable-prefix list.
   */
  readOnlyConfig: ReadOnlyConfig
}

export interface WorkspaceHandle {
  bash: Bash
  fs: ScopedFs
  innerFs: InMemoryFs
  initialSnapshot: Map<string, string>
  agentsMdSource: string
  materializers: MaterializerRegistry
}

/** The per-wake set of paths that eager-materialize at turn 0. */
export function buildFrozenEagerPaths(ids: {
  agentId: string
  contactId: string
  channelInstanceId: string
}): readonly string[] {
  return [
    `/agents/${ids.agentId}/AGENTS.md`,
    `/agents/${ids.agentId}/MEMORY.md`,
    `/drive/BUSINESS.md`,
    `/contacts/${ids.contactId}/${ids.channelInstanceId}/messages.md`,
    `/contacts/${ids.contactId}/${ids.channelInstanceId}/internal-notes.md`,
    `/contacts/${ids.contactId}/profile.md`,
    `/contacts/${ids.contactId}/MEMORY.md`,
  ]
}

export async function createWorkspace(opts: CreateWorkspaceOpts): Promise<WorkspaceHandle> {
  const innerFs = new InMemoryFs()
  const fs = new ScopedFs(innerFs, opts.readOnlyConfig)
  void opts.frozenEagerPaths

  const mats = new MaterializerRegistry(opts.materializers)
  const matCtx: MaterializerCtx = {
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    conversationId: opts.conversationId,
    contactId: opts.contactId,
    turnIndex: 0,
  }

  const agentPrefix = `/agents/${opts.agentId}`
  const contactPrefix = `/contacts/${opts.contactId}`
  const contactChannelPrefix = `/contacts/${opts.contactId}/${opts.channelInstanceId}`

  // ---- Eager writes (frozen zone) ----
  const agentsMdSource = generateAgentsMd({
    agentName: opts.agentDefinition.name,
    agentId: opts.agentId,
    commands: opts.commands,
    instructions: opts.agentDefinition.instructions ?? '',
  })
  await innerFs.writeFile(`${agentPrefix}/AGENTS.md`, agentsMdSource)
  await innerFs.writeFile(`${agentPrefix}/MEMORY.md`, opts.agentDefinition.workingMemory || EMPTY_MEMORY_MD)

  // BUSINESS.md — materializer may override; otherwise look up by convention.
  const businessMd = await loadBusinessMd(opts.drivePort, opts.organizationId)
  await innerFs.writeFile('/drive/BUSINESS.md', businessMd)

  // Conversation content — now keyed by (contactId, channelInstanceId).
  const messagesMd = await findMaterialized(mats, `${contactChannelPrefix}/messages.md`, matCtx, EMPTY_MESSAGES_MD)
  await innerFs.writeFile(`${contactChannelPrefix}/messages.md`, messagesMd)
  const notesMd = await findMaterialized(mats, `${contactChannelPrefix}/internal-notes.md`, matCtx, EMPTY_NOTES_MD)
  await innerFs.writeFile(`${contactChannelPrefix}/internal-notes.md`, notesMd)

  // Contact files.
  const profileMd = await findMaterialized(
    mats,
    `${contactPrefix}/profile.md`,
    matCtx,
    (await loadContactProfileFallback(opts.contactsPort, opts.contactId)) ?? contactProfileFallback(opts.contactId),
  )
  await innerFs.writeFile(`${contactPrefix}/profile.md`, profileMd)

  const contactMemoryMd = await findMaterialized(
    mats,
    `${contactPrefix}/MEMORY.md`,
    matCtx,
    (await loadContactMemoryFallback(opts.contactsPort, opts.contactId)) ?? EMPTY_MEMORY_MD,
  )
  await innerFs.writeFile(`${contactPrefix}/MEMORY.md`, contactMemoryMd)

  // Staff materializers (frozen phase). Any registered materializer whose path
  // starts with `/staff/<id>/` is eager-written here so the agent can `cat`
  // those paths in turn 0 without a DB round-trip.
  const seenStaffIds = new Set<string>()
  for (const m of mats.getFrozen()) {
    const staffMatch = m.path.match(/^\/staff\/([^/]+)\/(profile\.md|MEMORY\.md)$/)
    if (!staffMatch) continue
    const staffId = staffMatch[1]
    seenStaffIds.add(staffId)
    const body = await Promise.resolve(m.materialize(matCtx))
    await innerFs.writeFile(m.path, body)
  }

  // Ensure writable top-level dirs exist so `ls` lists them.
  await innerFs.mkdir('/tmp', { recursive: true })
  await innerFs.mkdir(`${contactPrefix}/drive`, { recursive: true })
  await innerFs.mkdir(contactChannelPrefix, { recursive: true })
  await innerFs.mkdir(`${agentPrefix}/skills`, { recursive: true })
  for (const staffId of seenStaffIds) {
    await innerFs.mkdir(`/staff/${staffId}`, { recursive: true })
  }

  // Capture initialSnapshot AFTER eager writes so dirty-tracking has a baseline.
  const initialSnapshot = await snapshotFs(innerFs)

  // ---- Lazy materializers (on-read) ----
  for (const m of mats.getOnRead()) {
    const resolve = m.materialize.bind(m)
    innerFs.writeFileLazy(m.path, async () => resolve(matCtx))
  }

  const [tenantTree, contactTree] = await Promise.all([
    safeListFolder(opts.drivePort, { scope: 'organization' }, null),
    safeListFolder(opts.drivePort, { scope: 'contact', contactId: opts.contactId }, null),
  ])

  for (const file of tenantTree) {
    if (file.kind !== 'file') continue
    const wsPath = `/drive${file.path}`
    if (wsPath === '/drive/BUSINESS.md') continue
    const id = file.id
    innerFs.writeFileLazy(wsPath, async () => {
      const body = await opts.drivePort.readContent(id)
      return body.content
    })
  }

  for (const file of contactTree) {
    if (file.kind !== 'file') continue
    const wsPath = `${contactPrefix}/drive${file.path}`
    const id = file.id
    innerFs.writeFileLazy(wsPath, async () => {
      const body = await opts.drivePort.readContent(id)
      return body.content
    })
  }

  // ---- Lazy skills/ mount ----
  try {
    const skills = await safeListSkills(opts.agentsPort, opts.agentId)
    for (const skill of skills) {
      const wsPath = `${agentPrefix}/skills/${skill.name}`
      const getBody = skill.getBody
      innerFs.writeFileLazy(wsPath, async () => getBody())
    }
  } catch {
    /* skills optional */
  }

  // ---- Build the Bash instance ----
  const commandCtx: CommandContext = {
    organizationId: opts.organizationId,
    conversationId: opts.conversationId,
    agentId: opts.agentId,
    contactId: opts.contactId,
    writeWorkspace: async (path, content) => innerFs.writeFile(path, content),
    readWorkspace: async (path) => innerFs.readFile(path),
    ...(opts.commandCtx ?? {}),
  }

  const vobaseCmd = createVobaseCommand({
    commands: opts.commands,
    ctx: commandCtx,
    onSideEffect: opts.onSideEffect,
  })

  // Start the virtual shell at `/agents/<id>/` so relative paths resolve there.
  const bash = new Bash({
    fs,
    customCommands: [vobaseCmd],
    env: opts.env,
    cwd: agentPrefix,
  })

  // Wrap `bash.exec` so filesystem errors from `ScopedFs` surface as stderr
  // + non-zero exit rather than propagating out of the interpreter. `just-bash`
  // itself does not translate `IFileSystem.writeFile` throws into bash-style
  // error messages — we do it here.
  const rawExec = bash.exec.bind(bash)
  bash.exec = async (cmd: string, opts2?: Parameters<Bash['exec']>[1]) => {
    try {
      return await rawExec(cmd, opts2)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        stdout: '',
        stderr: msg.endsWith('\n') ? msg : `${msg}\n`,
        exitCode: 1,
        env: bash.getEnv(),
      }
    }
  }

  return { bash, fs, innerFs, initialSnapshot, agentsMdSource, materializers: mats }
}

// --- helpers ---------------------------------------------------------------

async function findMaterialized(
  mats: MaterializerRegistry,
  path: string,
  ctx: MaterializerCtx,
  fallback: string,
): Promise<string> {
  for (const m of mats.getFrozen()) {
    if (m.path === path) {
      return Promise.resolve(m.materialize(ctx))
    }
  }
  return fallback
}

async function loadBusinessMd(drive: FilesService, _tenantId: string): Promise<string> {
  try {
    const row = await drive.getByPath({ scope: 'organization' }, '/BUSINESS.md')
    if (!row) return BUSINESS_MD_FALLBACK
    if (row.extractedText) return row.extractedText
    try {
      const body = await drive.readContent(row.id)
      return body.content || BUSINESS_MD_FALLBACK
    } catch {
      return BUSINESS_MD_FALLBACK
    }
  } catch {
    return BUSINESS_MD_FALLBACK
  }
}

async function loadContactProfileFallback(port: ContactsService, contactId: string): Promise<string | null> {
  try {
    const c = await port.get(contactId)
    const identity = c.displayName ?? c.phone ?? c.email ?? c.id
    const lines: string[] = [`# ${identity} (${c.id})`, '']
    if (c.displayName) lines.push(`Display Name: ${c.displayName}`)
    if (c.phone) lines.push(`Phone: ${c.phone}`)
    if (c.email) lines.push(`Email: ${c.email}`)
    lines.push('')
    return lines.join('\n')
  } catch {
    return null
  }
}

async function loadContactMemoryFallback(port: ContactsService, contactId: string): Promise<string | null> {
  try {
    const body = await port.readNotes(contactId)
    return body || null
  } catch {
    return null
  }
}

async function safeListFolder(
  drive: FilesService,
  scope: Parameters<FilesService['listFolder']>[0],
  parentId: string | null,
): Promise<DriveFile[]> {
  try {
    return await drive.listFolder(scope, parentId)
  } catch {
    return []
  }
}

interface SkillRef {
  name: string
  getBody: () => Promise<string> | string
}

async function safeListSkills(port: AgentsPort, _agentId: string): Promise<SkillRef[]> {
  // AgentsPort does not yet expose skill listing — harness can still register
  // lazy skills via a materializer with `path: '/agents/<id>/skills/<name>.md'`.
  void port
  return []
}
