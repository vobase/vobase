/**
 * Cost-cap enforcer: read daily spend from `cost.ts`, fire `cost_threshold_crossed`
 * journal events at the soft (80%) and hard (100%) ceilings, and signal the
 * caller that the wake should pause (soft) or abort (hard).
 *
 * The actual pause/abort is owned by `create-harness.ts` — this module is
 * pure policy: given a spend, what should the wake do? Idempotent: a second
 * call with the same already-crossed phase is a no-op (no duplicate events).
 */

import { getDailySpend } from './cost'
import { append } from './journal'
import type { CostThresholdCrossedEvent, IterationBudget } from './types'

export type CostCapDecision = 'continue' | 'pause_for_approval' | 'abort'

export interface CostCapEvalInput {
  organizationId: string
  conversationId: string
  wakeId: string
  agentId: string
  turnIndex: number
  /** From the wake's iteration budget. */
  budget: IterationBudget
  /** Provide explicit spend to skip the DB read (used by tests + post-call hooks). */
  spendUsdOverride?: number
  now?: () => Date
}

export interface CostCapEvalResult {
  decision: CostCapDecision
  /** Latest spend (USD) read for this evaluation. */
  spentUsd: number
  /** Whichever ceiling fired, if any. */
  crossed?: 'soft' | 'hard'
}

interface CostCapTracker {
  evaluate(input: CostCapEvalInput): Promise<CostCapEvalResult>
  /** Test reset: forget every wake's last-fired phase. */
  reset(): void
}

/**
 * Per-wake memo of the last threshold we journaled, so subsequent evaluations
 * within the same wake don't re-fire the same event. Keyed by wakeId.
 */
function makeTracker(): CostCapTracker {
  const lastFired = new Map<string, 'soft' | 'hard'>()

  async function evaluate(input: CostCapEvalInput): Promise<CostCapEvalResult> {
    const now = (input.now ?? (() => new Date()))()
    const spent =
      input.spendUsdOverride !== undefined ? input.spendUsdOverride : await getDailySpend(input.organizationId)

    const soft = input.budget.softCostCeilingUsd
    const hard = input.budget.hardCostCeilingUsd

    let decision: CostCapDecision = 'continue'
    let crossed: 'soft' | 'hard' | undefined
    if (spent >= hard) {
      decision = 'abort'
      crossed = 'hard'
    } else if (spent >= soft) {
      decision = 'pause_for_approval'
      crossed = 'soft'
    }

    if (crossed && lastFired.get(input.wakeId) !== crossed) {
      const ceiling = crossed === 'hard' ? hard : soft
      const event: CostThresholdCrossedEvent = {
        type: 'cost_threshold_crossed',
        ts: now,
        wakeId: input.wakeId,
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        turnIndex: input.turnIndex,
        phase: crossed === 'hard' ? 'hard' : 'soft',
        spentUsd: spent,
        ceilingUsd: ceiling,
      }
      await append({
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        wakeId: input.wakeId,
        turnIndex: input.turnIndex,
        event,
      })
      lastFired.set(input.wakeId, crossed)
    }

    return { decision, spentUsd: spent, crossed }
  }

  function reset(): void {
    lastFired.clear()
  }

  return { evaluate, reset }
}

const tracker = makeTracker()

export function evaluateCostCap(input: CostCapEvalInput): Promise<CostCapEvalResult> {
  return tracker.evaluate(input)
}

export function __resetCostCapForTests(): void {
  tracker.reset()
}
