import type { ModuleDeps } from '@modules/messaging/lib/deps'
import type { VobaseDb } from '@vobase/core'

/** Result shape returned by all command handlers. */
export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Parsed arguments from a vobase subcommand invocation. */
export interface ParsedArgs {
  /** Named flags extracted from --key value pairs. */
  flags: Record<string, string>
  /** Remaining positional arguments after flag extraction. */
  positional: string[]
}

/**
 * Context available to every vobase command handler.
 * Assembled at wake time from the agent's current conversation context.
 */
export interface WakeContext {
  /** Database connection. */
  db: VobaseDb
  /** Full module dependencies (db, scheduler, channels, realtime, storage). */
  deps: ModuleDeps
  /** Active conversation ID the agent is operating on. */
  conversationId: string
  /** Contact ID for the current conversation's customer. */
  contactId: string
  /** Agent ID (Mastra agent identifier). */
  agentId: string
}

/**
 * A vobase subcommand handler function.
 * Receives parsed positional args, flags, and the wake context.
 */
export type CommandHandler = (
  positional: string[],
  flags: Record<string, string>,
  ctx: WakeContext,
) => Promise<CommandResult>

/** Success result. */
export function ok(stdout: string): CommandResult {
  return { stdout, stderr: '', exitCode: 0 }
}

/** Failure result. */
export function err(stderr: string): CommandResult {
  return { stdout: '', stderr, exitCode: 1 }
}
