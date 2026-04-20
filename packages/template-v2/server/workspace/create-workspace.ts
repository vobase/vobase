/**
 * Workspace factory.
 *
 * Assembles the `just-bash` `Bash` instance against an `InMemoryFs` wrapped in
 * `ScopedFs` (RO enforcer per plan B6). Eager-writes the frozen-zone files at
 * construction, captures the `initialSnapshot` for the dirty-tracker, and
 * registers lazy materializers for `drive/**`, `contact/drive/**`, `skills/**`,
 * and `contact/bookings.md`.
 *
 * Principle: mid-wake writes persist to disk immediately but are invisible to
 * the current turn's frozen zone (frozen-snapshot invariant). Lazy paths that are never `cat`ed stay
 * out of the snapshot and so cannot register as "dirty".
 */

import type { AgentsPort } from '@server/contracts/agents-port'
import type { ContactsPort } from '@server/contracts/contacts-port'
import type { AgentDefinition, DriveFile } from '@server/contracts/domain-types'
import type { DrivePort } from '@server/contracts/drive-port'
import type { CommandContext, CommandDef } from '@server/contracts/plugin-context'
import type { MaterializerCtx, WorkspaceMaterializer } from '@server/contracts/side-load'
import type { WorkspacePath } from '@server/runtime/define-module'
import { Bash, InMemoryFs } from 'just-bash'
import { generateAgentsMd } from './agents-md-generator'
import { snapshotFs } from './dirty-tracker'
import { MaterializerRegistry } from './materializer-registry'
import { type ReadOnlyConfig, ScopedFs } from './ro-enforcer'
import { createVobaseCommand } from './vobase-cli/dispatcher'

/** Built-in BUSINESS.md fallback stub — shown when no organization drive row exists. */
export const BUSINESS_MD_FALLBACK = `# Business Identity

No business profile configured. Ask staff to create /BUSINESS.md in the drive.
`

/** Built-in contact-profile fallback. */
const CONTACT_PROFILE_FALLBACK = `---
---

# Contact

_No profile configured yet._
`

const EMPTY_MESSAGES_MD = `# Conversation\n\n_No messages yet._\n`
const EMPTY_NOTES_MD = `# Internal Notes\n\n_No notes yet._\n`
const EMPTY_MEMORY_MD = `---
---

# Memory

_empty_
`
const EMPTY_BOOKINGS_MD = `# Bookings\n\n_No appointments yet._\n`

export interface CreateWorkspaceOpts {
  organizationId: string
  agentId: string
  contactId: string
  conversationId: string
  wakeId: string
  /** The frozen-at-wake-start agent definition; determines `SOUL.md` + `MEMORY.md`. */
  agentDefinition: AgentDefinition
  /** Used by `CommandContext.writeWorkspace` and `readWorkspace`. */
  commandCtx?: Partial<CommandContext>
  /** Aggregated from every module's `registerCommand(...)`. */
  commands: readonly CommandDef[]
  /** Aggregated from every module's `registerWorkspaceMaterializer(...)`. */
  materializers: readonly WorkspaceMaterializer[]
  /** Cross-module ports — harness injects the real ones; tests can pass stubs. */
  drivePort: DrivePort
  contactsPort: ContactsPort
  agentsPort: AgentsPort
  /** Side-effect callback; fires once per non-read-only vobase subcommand. */
  onSideEffect?: (cmd: CommandDef) => void
  /** Optional env passed through to `Bash`. */
  env?: Record<string, string>
  /**
   * Paths to eagerly materialize at wake turn-0. Phase 0 default is the literal
   * `FROZEN_EAGER_PATHS` list; Steps 6+ source this from merged module manifests.
   */
  frozenEagerPaths?: readonly WorkspacePath[]
  /**
   * Effective RO/writable configuration for `ScopedFs`. Defaults to the current
   * literals; Steps 6+ derive this from merged module manifests.
   */
  readOnlyConfig?: ReadOnlyConfig
}

export interface WorkspaceHandle {
  bash: Bash
  fs: ScopedFs
  innerFs: InMemoryFs
  initialSnapshot: Map<string, string>
  agentsMdSource: string
  materializers: MaterializerRegistry
}

/** The 8 top-level `/workspace/…` paths that eager-materialize at wake start. */
export const FROZEN_EAGER_PATHS = [
  '/workspace/AGENTS.md',
  '/workspace/SOUL.md',
  '/workspace/MEMORY.md',
  '/workspace/drive/BUSINESS.md',
  '/workspace/conversation/messages.md',
  '/workspace/conversation/internal-notes.md',
  '/workspace/contact/profile.md',
  '/workspace/contact/MEMORY.md',
] as const

export async function createWorkspace(opts: CreateWorkspaceOpts): Promise<WorkspaceHandle> {
  const innerFs = new InMemoryFs()
  const fs = opts.readOnlyConfig ? new ScopedFs(innerFs, opts.readOnlyConfig) : new ScopedFs(innerFs)
  // `opts.frozenEagerPaths` is a Phase 0 hook; today the eager-write block below
  // uses hardcoded paths and per-path loaders. Steps 6+ move each path to a
  // module-registered materializer resolved here via `MaterializerRegistry`.
  void opts.frozenEagerPaths

  const mats = new MaterializerRegistry(opts.materializers)
  const matCtx: MaterializerCtx = {
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    conversationId: opts.conversationId,
    contactId: opts.contactId,
    turnIndex: 0,
  }

  // ---- Eager writes (frozen zone) ----
  const agentsMdSource = generateAgentsMd({ commands: opts.commands })
  await innerFs.writeFile('/workspace/AGENTS.md', agentsMdSource)
  await innerFs.writeFile('/workspace/SOUL.md', opts.agentDefinition.soulMd ?? '')
  await innerFs.writeFile('/workspace/MEMORY.md', opts.agentDefinition.workingMemory || EMPTY_MEMORY_MD)

  // BUSINESS.md — materializer may override; otherwise look up by convention (R8).
  const businessMd = await loadBusinessMd(opts.drivePort, opts.organizationId)
  await innerFs.writeFile('/workspace/drive/BUSINESS.md', businessMd)

  // Conversation files — materializer-first, then fallback.
  const messagesMd = await findMaterialized(mats, '/workspace/conversation/messages.md', matCtx, EMPTY_MESSAGES_MD)
  await innerFs.writeFile('/workspace/conversation/messages.md', messagesMd)
  const notesMd = await findMaterialized(mats, '/workspace/conversation/internal-notes.md', matCtx, EMPTY_NOTES_MD)
  await innerFs.writeFile('/workspace/conversation/internal-notes.md', notesMd)

  // Contact files.
  const profileMd = await findMaterialized(
    mats,
    '/workspace/contact/profile.md',
    matCtx,
    (await loadContactProfileFallback(opts.contactsPort, opts.contactId)) ?? CONTACT_PROFILE_FALLBACK,
  )
  await innerFs.writeFile('/workspace/contact/profile.md', profileMd)

  const contactMemoryMd = await findMaterialized(
    mats,
    '/workspace/contact/MEMORY.md',
    matCtx,
    (await loadContactMemoryFallback(opts.contactsPort, opts.contactId)) ?? EMPTY_MEMORY_MD,
  )
  await innerFs.writeFile('/workspace/contact/MEMORY.md', contactMemoryMd)

  // Ensure writable top-level dirs exist so `ls` lists them.
  await innerFs.mkdir('/workspace/tmp', { recursive: true })
  await innerFs.mkdir('/workspace/contact/drive', { recursive: true })
  await innerFs.mkdir('/workspace/skills', { recursive: true })

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
    const wsPath = `/workspace/drive${file.path}`
    if (wsPath === '/workspace/drive/BUSINESS.md') continue
    const id = file.id
    innerFs.writeFileLazy(wsPath, async () => {
      const body = await opts.drivePort.readContent(id)
      return body.content
    })
  }

  for (const file of contactTree) {
    if (file.kind !== 'file') continue
    const wsPath = `/workspace/contact/drive${file.path}`
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
      const wsPath = `/workspace/skills/${skill.name}`
      const getBody = skill.getBody
      innerFs.writeFileLazy(wsPath, async () => getBody())
    }
  } catch {
    /* skills optional in Phase 1 */
  }

  // ---- Lazy bookings.md ----
  innerFs.writeFileLazy('/workspace/contact/bookings.md', async () => EMPTY_BOOKINGS_MD)

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

  const bash = new Bash({
    fs,
    customCommands: [vobaseCmd],
    env: opts.env,
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

/** Plan R8 / test assertion 4b — BUSINESS.md falls back to the stub if the organization row is missing. */
async function loadBusinessMd(drive: DrivePort, _tenantId: string): Promise<string> {
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

async function loadContactProfileFallback(port: ContactsPort, contactId: string): Promise<string | null> {
  try {
    const c = await port.get(contactId)
    const lines = [
      `---`,
      `id: ${c.id}`,
      `displayName: ${c.displayName ?? ''}`,
      `phone: ${c.phone ?? ''}`,
      `email: ${c.email ?? ''}`,
      `---`,
      '',
      `# Contact`,
      '',
    ]
    return lines.join('\n')
  } catch {
    return null
  }
}

async function loadContactMemoryFallback(port: ContactsPort, contactId: string): Promise<string | null> {
  try {
    const body = await port.readWorkingMemory(contactId)
    return body || null
  } catch {
    return null
  }
}

async function safeListFolder(
  drive: DrivePort,
  scope: Parameters<DrivePort['listFolder']>[0],
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
  // Phase 1: AgentsPort does not yet expose skill listing — Phase 2 adds it.
  // Harness can still register lazy skills via a materializer with `path: '/workspace/skills/<name>.md'`.
  void port
  return []
}
