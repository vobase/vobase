/**
 * AgentMutator — block-or-transform hook at tool boundaries.
 *
 * The chain is deterministic: `before` hooks run in registration order, first
 * `{action:'block'}` wins, `{action:'transform'}` rewrites args for subsequent
 * mutators + the tool execution itself.
 *
 * `MutatorContext.db` is a `ScopedDb` (writable capability) so mutators can
 * persist state through the same drizzle handle module services already use.
 *
 * `persistEvent` is PRESERVED alongside `db` — the approval gate wiring
 * (`approvalMutator`) depends on it for the single-purpose event-emit path.
 * Mutators may use either escape hatch.
 */

import type { AgentEvent } from './event'
import type { Logger, ObserverContext } from './observer'
import type { PluginContext } from './plugin-context'
import type { ScopedDb } from './scoped-db'
import type { ToolResult } from './tool-result'

/** The tool call a mutator sees BEFORE the tool runs. */
export interface AgentStep {
  toolCallId: string
  toolName: string
  args: unknown
}

export interface StepResult {
  toolCallId: string
  toolName: string
  result: ToolResult
}

export type MutatorDecision = { action: 'block'; reason: string } | { action: 'transform'; args: unknown }

export interface MutatorContext extends ObserverContext {
  readonly db: ScopedDb
  readonly llmCall: PluginContext['llmCall']
  /** For mutators that need to persist state (e.g. approvalMutator inserts pending_approvals). */
  readonly persistEvent: (event: AgentEvent) => Promise<void>
  readonly logger: Logger
}

export interface AgentMutator {
  id: string
  before?(step: AgentStep, ctx: MutatorContext): Promise<MutatorDecision | undefined> | MutatorDecision | undefined
  after?(
    step: AgentStep,
    result: StepResult,
    ctx: MutatorContext,
  ): Promise<StepResult | undefined> | StepResult | undefined
}
