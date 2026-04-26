/**
 * `vobase` CLI dispatcher — promoted from the helpdesk template into core so
 * any project built on `@vobase/core` ships the same just-bash integration.
 *
 * The dispatcher routes argv → a module-contributed `CommandDef.execute`.
 * Command names can be multi-word (`memory set`) and the dispatcher matches
 * the longest-prefix command name against argv left-to-right.
 *
 * ## Role-aware verb sets
 *
 * Concierge agents (talk to end users) and operator agents (run jobs/tasks)
 * disagree on which verbs are safe to expose. The dispatcher accepts EITHER:
 *
 *   • a flat `commands` list (legacy, single-role boot), OR
 *   • a `roleVerbSets` map keyed by role + a `currentRole` selector.
 *
 * Role-set boot detects collisions: if the same `name` appears in more than
 * one role set, `createVobaseCommand` throws at construction time (boot, not
 * mid-wake). Tests pin this. The `commands` field still works alongside
 * `roleVerbSets` for shared verbs (`help`, `memory view`) registered globally.
 */

import type { Command, ExecResult } from 'just-bash'
import { defineCommand } from 'just-bash'

import type { CommandContext, CommandDef } from '../../harness/types'

export const DEFAULT_READ_ONLY_VERBS: ReadonlySet<string> = new Set([
  'memory view',
  'memory list',
  'check-slots',
  'help',
])

export type AgentRole = string

export interface VobaseDispatcherOpts {
  /**
   * Flat command list — used when the project doesn't split verbs by role.
   * If `roleVerbSets` is also supplied, both lists merge (with collision
   * detection) and only the entries in `currentRole`'s set + this list are
   * exposed at dispatch time.
   */
  commands?: readonly CommandDef[]
  /**
   * Role-keyed verb sets. Each role gets its own array; the dispatcher
   * exposes only the set for `currentRole` plus any role-agnostic
   * `commands`. Collisions across roles or with `commands` throw at boot.
   */
  roleVerbSets?: Readonly<Record<AgentRole, readonly CommandDef[]>>
  /** Active agent role; required when `roleVerbSets` is provided. */
  currentRole?: AgentRole
  ctx: CommandContext
  /** Called once per successful side-effect command (tracks wake "did-something" heuristic). */
  onSideEffect?: (cmd: CommandDef) => void
  /** Read-only verbs that should NOT trigger `onSideEffect`. */
  readOnlyVerbs?: readonly string[]
}

export class VobaseCliCollisionError extends Error {
  override readonly name = 'VobaseCliCollisionError'
}

/**
 * Resolves the active command list for a given role and asserts that no
 * verb name appears more than once across `commands` + every `roleVerbSets`
 * bucket. Collisions are a boot-time bug — two modules registering the same
 * verb means an agent's behaviour depends on import order.
 */
export function resolveCommandSet(opts: VobaseDispatcherOpts): readonly CommandDef[] {
  const seen = new Map<string, string>() // name → origin (e.g. 'commands' or `role:operator`)
  const collide = (name: string, origin: string): void => {
    const prior = seen.get(name)
    if (prior !== undefined) {
      throw new VobaseCliCollisionError(
        `vobase CLI: duplicate verb "${name}" registered by ${prior} and ${origin}; rename one to avoid ambiguity.`,
      )
    }
    seen.set(name, origin)
  }

  for (const cmd of opts.commands ?? []) collide(cmd.name, 'commands')

  const sets = opts.roleVerbSets
  if (sets) {
    for (const [role, list] of Object.entries(sets)) {
      for (const cmd of list) collide(cmd.name, `role:${role}`)
    }
  }

  // Active set = global `commands` + the role's verbs (if any).
  const active: CommandDef[] = [...(opts.commands ?? [])]
  if (sets && opts.currentRole !== undefined) {
    const roleSet = sets[opts.currentRole]
    if (roleSet) active.push(...roleSet)
  }
  return active
}

/** Best-match lookup: prefer the longest-prefix command name. */
export function findCommand(
  argv: readonly string[],
  commands: readonly CommandDef[],
): { cmd: CommandDef | null; nameTokens: number } {
  if (argv.length === 0) return { cmd: null, nameTokens: 0 }
  let best: CommandDef | null = null
  let bestTokens = 0
  for (const cmd of commands) {
    const tokens = cmd.name.split(/\s+/u)
    if (tokens.length > argv.length) continue
    let matched = true
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i] !== argv[i]) {
        matched = false
        break
      }
    }
    if (matched && tokens.length > bestTokens) {
      best = cmd
      bestTokens = tokens.length
    }
  }
  return { cmd: best, nameTokens: bestTokens }
}

function renderHelp(commands: readonly CommandDef[]): string {
  if (commands.length === 0) return 'vobase: no commands registered\n'
  const sorted = [...commands].sort((a, b) => a.name.localeCompare(b.name))
  const lines = ['vobase subcommands:']
  for (const cmd of sorted) {
    lines.push(`  vobase ${cmd.name.padEnd(30, ' ')} ${cmd.description ?? ''}`.trimEnd())
  }
  return `${lines.join('\n')}\n`
}

export function createVobaseCommand(opts: VobaseDispatcherOpts): Command {
  const commands = resolveCommandSet(opts)
  const readOnly = new Set(opts.readOnlyVerbs ?? DEFAULT_READ_ONLY_VERBS)

  return defineCommand('vobase', async (args: string[]): Promise<ExecResult> => {
    if (args.length === 0 || args[0] === '--help' || args[0] === 'help') {
      return { stdout: renderHelp(commands), stderr: '', exitCode: 0 }
    }

    const { cmd, nameTokens } = findCommand(args, commands)
    if (!cmd) {
      return {
        stdout: '',
        stderr: `vobase: unknown subcommand "${args[0]}". Run \`vobase help\` to list commands.\n`,
        exitCode: 1,
      }
    }

    const rest = args.slice(nameTokens)
    try {
      const result = await cmd.execute(rest, opts.ctx)
      if (result.ok) {
        const out = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
        const stdout = out.endsWith('\n') ? out : `${out}\n`
        if (!readOnly.has(cmd.name)) opts.onSideEffect?.(cmd)
        return { stdout, stderr: '', exitCode: 0 }
      }
      return { stdout: '', stderr: `vobase ${cmd.name}: ${result.error}\n`, exitCode: 1 }
    } catch (err) {
      return {
        stdout: '',
        stderr: `vobase ${cmd.name}: internal error: ${err instanceof Error ? err.message : String(err)}\n`,
        exitCode: 1,
      }
    }
  })
}
