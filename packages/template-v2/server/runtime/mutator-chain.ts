/**
 * MutatorChain — first-block-wins semantics.
 *
 * `runBefore` walks mutators in registration order; first `{action:'block'}`
 * returned is the final decision. `{action:'transform'}` rewrites args for every
 * subsequent mutator AND for the tool execution itself.
 *
 * Phase 1 ships only one mutator (`approvalMutator`); Phase 2 adds `moderationMutator`
 * which stress-tests the ordering.
 */
import type { AgentMutator, AgentStep, MutatorContext, MutatorDecision, StepResult } from '@server/contracts/mutator'

export class MutatorChain {
  constructor(private readonly mutators: readonly AgentMutator[]) {}

  static empty(): MutatorChain {
    return new MutatorChain([])
  }

  async runBefore(step: AgentStep, ctx: MutatorContext): Promise<MutatorDecision | undefined> {
    let currentArgs = step.args
    for (const m of this.mutators) {
      if (!m.before) continue
      const decision = await m.before({ ...step, args: currentArgs }, ctx)
      if (!decision) continue
      if (decision.action === 'block') return decision
      if (decision.action === 'transform') currentArgs = decision.args
    }
    return undefined
  }

  async runAfter(step: AgentStep, result: StepResult, ctx: MutatorContext): Promise<StepResult> {
    let current = result
    for (const m of this.mutators) {
      if (!m.after) continue
      const replacement = await m.after(step, current, ctx)
      if (replacement) current = replacement
    }
    return current
  }

  size(): number {
    return this.mutators.length
  }
}
