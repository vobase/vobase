/**
 * `vobase` CLI dispatcher.
 *
 * Exposed to `just-bash` as a single custom command via `defineCommand('vobase', …)`.
 * The command routes argv to a module-contributed `CommandDef.execute(argv, ctx)`.
 * Names can be multi-word (e.g. `"memory set"`) — the dispatcher matches the
 * longest-prefix command name against argv, left-to-right.
 */

import type { CommandContext, CommandDef } from '@server/contracts/plugin-context'
import type { Command, ExecResult } from 'just-bash'
import { defineCommand } from 'just-bash'

export interface VobaseDispatcherOpts {
  commands: readonly CommandDef[]
  ctx: CommandContext
  /** Called once per successful side-effect command (tracks wake "did-something" heuristic). */
  onSideEffect?: (cmd: CommandDef) => void
  /** Read-only verbs that should NOT trigger `onSideEffect`. */
  readOnlyVerbs?: readonly string[]
}

const DEFAULT_READ_ONLY_VERBS = new Set(['memory view', 'memory list', 'check-slots', 'help'])

/** Best-match lookup: prefer the longest-prefix command name. */
function findCommand(
  argv: readonly string[],
  commands: readonly CommandDef[],
): {
  cmd: CommandDef | null
  nameTokens: number
} {
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
  const readOnly = new Set(opts.readOnlyVerbs ?? DEFAULT_READ_ONLY_VERBS)

  return defineCommand('vobase', async (args: string[]): Promise<ExecResult> => {
    if (args.length === 0 || args[0] === '--help' || args[0] === 'help') {
      return { stdout: renderHelp(opts.commands), stderr: '', exitCode: 0 }
    }

    const { cmd, nameTokens } = findCommand(args, opts.commands)
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
      return {
        stdout: '',
        stderr: `vobase ${cmd.name}: ${result.error}\n`,
        exitCode: 1,
      }
    } catch (err) {
      return {
        stdout: '',
        stderr: `vobase ${cmd.name}: internal error: ${err instanceof Error ? err.message : String(err)}\n`,
        exitCode: 1,
      }
    }
  })
}
