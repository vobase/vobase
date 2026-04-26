/**
 * Cost-cap enforcer: read daily spend from `cost.ts`, fire `cost_threshold_crossed`
 * journal events at the soft (80%) and hard (100%) ceilings, and signal the
 * caller that the wake should pause (soft) or abort (hard).
 *
 * The actual pause/abort is owned by `create-harness.ts` — this module is
 * pure policy: given a spend, what should the wake do? Idempotent: a second
 * call with the same already-crossed phase is a no-op (no duplicate events).
 *
 * Per-org running spend is cached in-process and refreshed from PG only on a
 * coarse interval (default 30s). Each evaluate adds the wake's per-turn delta
 * so we don't round-trip the database every assistant message.
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
  /**
   * Incremental USD spent during this turn (just this assistant message).
   * Folded into the in-process running total so subsequent evals don't refetch
   * from the DB. Ignored when `spendUsdOverride` is supplied.
   */
  turnCostUsdDelta?: number
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
  /** Drop a finished wake's last-fired memo so the map doesn't leak. */
  releaseWake(wakeId: string): void
  /** Test reset: forget every wake's last-fired phase. */
  reset(): void
}

/** How long a cached per-org spend is trusted before refetching from PG. */
const REFRESH_INTERVAL_MS = 30_000

interface OrgSpendCache {
  spentUsd: number
  refreshedAt: number
}

/**
 * Per-wake memo of the last threshold we journaled, so subsequent evaluations
 * within the same wake don't re-fire the same event. Keyed by wakeId.
 */
function makeTracker(): CostCapTracker {
  const lastFired = new Map<string, 'soft' | 'hard'>()
  const orgSpend = new Map<string, OrgSpendCache>()

  async function evaluate(input: CostCapEvalInput): Promise<CostCapEvalResult> {
    const now = (input.now ?? (() => new Date()))()
    const nowMs = now.getTime()
    let spent: number
    if (input.spendUsdOverride !== undefined) {
      spent = input.spendUsdOverride
    } else {
      const cached = orgSpend.get(input.organizationId)
      const stale = !cached || nowMs - cached.refreshedAt >= REFRESH_INTERVAL_MS
      if (stale) {
        spent = await getDailySpend(input.organizationId)
        orgSpend.set(input.organizationId, { spentUsd: spent, refreshedAt: nowMs })
      } else {
        spent = cached.spentUsd + (input.turnCostUsdDelta ?? 0)
        orgSpend.set(input.organizationId, { spentUsd: spent, refreshedAt: cached.refreshedAt })
      }
    }

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
    orgSpend.clear()
  }

  function releaseWake(wakeId: string): void {
    lastFired.delete(wakeId)
  }

  return { evaluate, releaseWake, reset }
}

const tracker = makeTracker()

export function evaluateCostCap(input: CostCapEvalInput): Promise<CostCapEvalResult> {
  return tracker.evaluate(input)
}

export function releaseCostCapWake(wakeId: string): void {
  tracker.releaseWake(wakeId)
}

export function __resetCostCapForTests(): void {
  tracker.reset()
}
