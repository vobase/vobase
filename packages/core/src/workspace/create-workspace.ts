/**
 * Workspace factory — domain-free.
 *
 * Assembles the `just-bash` `Bash` instance against an `InMemoryFs` wrapped in
 * `ScopedFs` (RO enforcer). Eager-writes every frozen-phase materializer at
 * construction, registers lazy on-read materializers, and captures
 * `initialSnapshot` for the dirty-tracker.
 *
 * Principle: all workspace content originates from module-contributed
 * materializers. The factory itself knows nothing about agents, contacts,
 * drive, team, or messaging — callers supply `materializers` and
 * `readOnlyConfig`, and the factory renders them uniformly. Mid-wake writes
 * persist to disk immediately but are invisible to the current turn's frozen
 * zone (frozen-snapshot invariant).
 */

import { Bash, type Command, InMemoryFs } from 'just-bash'

import type { CommandContext, CommandDef, MaterializerCtx, WorkspaceMaterializer } from '../harness/types'
import { snapshotFs } from './dirty-tracker'
import { MaterializerRegistry } from './materializer-registry'
import { type ReadOnlyConfig, ScopedFs } from './ro-enforcer'

export interface CreateWorkspaceOpts {
  /** Module-contributed materializers. All frozen-phase entries run eagerly. */
  materializers: readonly WorkspaceMaterializer[]
  /** Wake-scoped RO/writable configuration for `ScopedFs`. */
  readOnlyConfig: ReadOnlyConfig
  /** Passed verbatim to every `materialize(ctx)` call. */
  ctx: MaterializerCtx
  /** Custom `vobase` subcommands bound into the bash `customCommands`. */
  commands?: readonly CommandDef[]
  /** Optional partial overrides merged into the dispatcher's `CommandContext`. */
  commandCtx?: Partial<CommandContext>
  /** Fires once per non-read-only vobase subcommand. */
  onSideEffect?: (cmd: CommandDef) => void
  /** Optional env passed through to `Bash`. */
  env?: Record<string, string>
  /**
   * Absolute path the bash shell starts in. Defaults to `/` — callers (e.g. a
   * helpdesk template) typically set `/agents/<agentId>` so relative paths
   * resolve there.
   */
  cwd?: string
  /**
   * Custom `vobase` command builder. Accepts the resolved commands + ctx and
   * returns the bash `CustomCommand` to register. When omitted, the bash has
   * no `vobase` command registered (callers install their own dispatcher).
   */
  buildVobaseCommand?: (opts: {
    commands: readonly CommandDef[]
    ctx: CommandContext
    onSideEffect?: (cmd: CommandDef) => void
  }) => Command
}

export interface WorkspaceHandle {
  bash: Bash
  fs: ScopedFs
  innerFs: InMemoryFs
  initialSnapshot: Map<string, string>
  materializers: MaterializerRegistry
}

export async function createWorkspace(opts: CreateWorkspaceOpts): Promise<WorkspaceHandle> {
  const innerFs = new InMemoryFs()
  const fs = new ScopedFs(innerFs, opts.readOnlyConfig)
  const mats = new MaterializerRegistry(opts.materializers)

  // Frozen materializers commonly hit the DB; run them in parallel. InMemoryFs
  // writes are in-process so contention is nil. If two materializers target
  // the same path the registry's insertion order resolves last-write-wins.
  await Promise.all(
    mats.getFrozen().map(async (m) => {
      const body = await m.materialize(opts.ctx)
      await innerFs.writeFile(m.path, body)
    }),
  )

  // Snapshot AFTER eager writes — this is the baseline DirtyTracker diffs against.
  const initialSnapshot = await snapshotFs(innerFs)

  for (const m of mats.getOnRead()) {
    const resolve = m.materialize.bind(m)
    innerFs.writeFileLazy(m.path, async () => resolve(opts.ctx))
  }

  const commandCtx: CommandContext = {
    organizationId: opts.ctx.organizationId,
    conversationId: opts.ctx.conversationId,
    agentId: opts.ctx.agentId,
    contactId: opts.ctx.contactId,
    writeWorkspace: async (path, content) => innerFs.writeFile(path, content),
    readWorkspace: async (path) => innerFs.readFile(path),
    ...(opts.commandCtx ?? {}),
  }

  const customCommands = opts.buildVobaseCommand
    ? [opts.buildVobaseCommand({ commands: opts.commands ?? [], ctx: commandCtx, onSideEffect: opts.onSideEffect })]
    : undefined

  const bash = new Bash({
    fs,
    customCommands,
    env: opts.env,
    cwd: opts.cwd ?? '/',
  })

  // `just-bash` does not translate `IFileSystem.writeFile` throws into
  // stderr + non-zero exit, so ScopedFs RO violations would otherwise escape
  // the interpreter. Wrap exec to convert them.
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

  return { bash, fs, innerFs, initialSnapshot, materializers: mats }
}
