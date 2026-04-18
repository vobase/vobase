/**
 * AgentMutator — block-or-transform hook at tool boundaries. Spec §6.6 + §12.3.
 *
 * The chain is deterministic: `before` hooks run in registration order, first
 * `{action:'block'}` wins, `{action:'transform'}` rewrites args for subsequent
 * mutators + the tool execution itself.
 *
 * ## Phase-1 narrowing of MutatorContext (plan §P2.0, A8)
 *
 * Spec §6.6 defines MutatorContext with `readonly db: ScopedDb` (writable capability).
 * Phase 1 shipped a NARROWER contract: `persistEvent` only. The harness sets `db: null as
 * never` because the real writable ScopedDb is a Phase 3+ primitive (see agent-runner.ts:351).
 *
 * Phase 2 preserves `persistEvent` as the operative mutator contract. The broader
 * `db: ScopedDb` slot is explicitly deferred to Phase 3 when ScopedDb lands.
 *
 * This narrowing is DELIBERATE — do not remove `persistEvent` or expand to full `db`
 * without landing ScopedDb in Phase 3 first.
 */

import type { AgentEvent } from './event'
import type { Logger, ObserverContext } from './observer'
import type { PluginContext } from './plugin-context'
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
  readonly db: PluginContext['db']
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
