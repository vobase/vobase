import type { CommandHandler, CommandResult, ParsedArgs, WakeContext } from './types'

/**
 * Minimal just-bash CommandContext shape.
 * We only need the type signature for the execute callback — the full
 * CommandContext comes from just-bash at runtime via bash-tool.
 */
interface BashCommandContext {
  fs: unknown
  cwd: string
  env: Map<string, string>
  stdin: string
}

/**
 * Parse arguments from a vobase subcommand invocation.
 * Extracts --key value pairs into flags and collects remaining positional args.
 *
 * Example: ['reply', '--format', 'card', 'Hello', 'world']
 *   → { flags: { format: 'card' }, positional: ['reply', 'Hello', 'world'] }
 */
export function parseArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string> = {}
  const positional: string[] = []

  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg.startsWith('--') && i + 1 < args.length) {
      const key = arg.slice(2)
      flags[key] = args[i + 1]
      i += 2
    } else {
      positional.push(arg)
      i++
    }
  }

  return { flags, positional }
}

/** Command registry: subcommand name → handler function. */
type CommandRegistry = Record<string, CommandHandler>

const HELP_TEXT = `vobase — workspace CLI for the AI agent

CONVERSATION
  vobase reply <message>                        Send a text reply to the customer
  vobase card <body> [--title T] [--buttons a,b] Send an interactive card with buttons
  vobase resolve [--reason R]                   Mark conversation resolved
  vobase reassign <type:value> [--summary S]    Hand off to staff/agent
  vobase hold [--reason R]                      Put conversation on hold
  vobase mention <type:value> <note>            Internal note @mentioning staff
  vobase draft <message> [--reviewer type:val]  Create draft for human review
  vobase topic <summary> [--next T]             Insert topic change marker
  vobase remind <contactId> <msg> --channel C   Send appointment reminder
  vobase follow-up <seconds> [--reason R]       Schedule a follow-up wake

BOOKING
  vobase check-slots <date> [--service S]       Check available time slots
  vobase book <datetime> --service S             Book an appointment
  vobase reschedule <bookingId> <datetime>       Reschedule a booking
  vobase cancel <bookingId> [--reason R]          Cancel a booking

QUERY
  vobase search-kb <query>                      Search knowledge base
  vobase analyze-media <messageId> <question>   Analyze image/document in detail
  vobase list-conversations [--status S]        List contact's conversations
  vobase recall <query>                         Search past conversation history
`

/** Commands that produce side effects (DB writes, messages sent, etc.). */
const READ_ONLY_COMMANDS = new Set([
  'help',
  'search-kb',
  'analyze-media',
  'list-conversations',
  'recall',
  'check-slots',
])

/**
 * Create the vobase Command object for registration with just-bash.
 *
 * The WakeContext is provided at agent wake time and closed over by the command.
 * Subcommand handlers are registered via the registry — other workers will
 * populate conversation.ts, booking.ts, and query.ts handlers.
 *
 * @param onSideEffect - Called after the first successful write command executes.
 *   Used by agent-wake to track whether the run has produced irreversible effects.
 */
export function createVobaseCommand(wakeCtx: WakeContext, registry: CommandRegistry, onSideEffect?: () => void) {
  let sideEffectFired = false

  return {
    name: 'vobase',
    trusted: true,
    execute: async (args: string[], _ctx: BashCommandContext): Promise<CommandResult> => {
      if (args.length === 0 || args[0] === 'help') {
        return { stdout: HELP_TEXT, stderr: '', exitCode: 0 }
      }

      const subcommand = args[0]
      const handler = registry[subcommand]

      if (!handler) {
        return {
          stdout: '',
          stderr: `Unknown command: vobase ${subcommand}\nRun: vobase help`,
          exitCode: 1,
        }
      }

      const { flags, positional } = parseArgs(args.slice(1))

      try {
        const result = await handler(positional, flags, wakeCtx)

        // Mark side effect after first successful write command
        if (!sideEffectFired && result.exitCode === 0 && !READ_ONLY_COMMANDS.has(subcommand)) {
          sideEffectFired = true
          onSideEffect?.()
        }

        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { stdout: '', stderr: `Error: ${message}`, exitCode: 1 }
      }
    },
  }
}

/**
 * Build the full command registry by merging handler maps from each command group.
 * Called at wake time after all command modules are imported.
 */
export function buildRegistry(...groups: CommandRegistry[]): CommandRegistry {
  const registry: CommandRegistry = {}
  for (const group of groups) {
    for (const [name, handler] of Object.entries(group)) {
      registry[name] = handler
    }
  }
  return registry
}

export type {
  CommandHandler,
  CommandResult,
  ParsedArgs,
  WakeContext,
} from './types'
