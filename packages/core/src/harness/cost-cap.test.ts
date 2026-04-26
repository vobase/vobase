import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { __resetCostServiceForTests, createCostService, installCostService } from './cost'
import { __resetCostCapForTests, evaluateCostCap } from './cost-cap'
import { __resetJournalServiceForTests, installJournalService } from './journal'
import type { IterationBudget } from './types'

const budget: IterationBudget = {
  maxTurnsPerWake: 8,
  softCostCeilingUsd: 0.8,
  hardCostCeilingUsd: 1.0,
  maxOutputTokens: 4096,
  maxInputTokens: 200_000,
}

const baseInput = {
  organizationId: 'o1',
  conversationId: 'c1',
  wakeId: 'w1',
  agentId: 'a1',
  turnIndex: 0,
  budget,
}

beforeEach(() => {
  __resetCostCapForTests()
  __resetJournalServiceForTests()
  __resetCostServiceForTests()
  // The tracker reads through `getDailySpend` — provide a no-op cost service
  // so the production code path is exercised even when we override the spend.
  installCostService(
    createCostService({
      db: {
        insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) }),
        select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
      },
    }),
  )
  const journals: Array<{ type: string }> = []
  installJournalService({
    append: (input) => {
      const ev = input.event as { type: string }
      journals.push({ type: ev.type })
      return Promise.resolve()
    },
    getLastWakeTail: () => Promise.resolve({ interrupted: false }),
    getLatestTurnIndex: () => Promise.resolve(0),
  })
  ;(globalThis as unknown as { __ccJournals: Array<{ type: string }> }).__ccJournals = journals
})

afterEach(() => {
  __resetCostCapForTests()
  __resetJournalServiceForTests()
  __resetCostServiceForTests()
})

function readJournals(): Array<{ type: string }> {
  return (globalThis as unknown as { __ccJournals: Array<{ type: string }> }).__ccJournals
}

describe('cost-cap', () => {
  it('returns continue when below soft ceiling', async () => {
    const res = await evaluateCostCap({ ...baseInput, spendUsdOverride: 0.4 })
    expect(res.decision).toBe('continue')
    expect(res.crossed).toBeUndefined()
    expect(readJournals()).toHaveLength(0)
  })

  it('pauses for approval at the soft (80%) ceiling and journals once', async () => {
    const res = await evaluateCostCap({ ...baseInput, spendUsdOverride: 0.85 })
    expect(res.decision).toBe('pause_for_approval')
    expect(res.crossed).toBe('soft')
    const types = readJournals().map((j) => j.type)
    expect(types).toEqual(['cost_threshold_crossed'])

    // Idempotent: a second eval at the same phase doesn't re-emit.
    const again = await evaluateCostCap({ ...baseInput, spendUsdOverride: 0.92 })
    expect(again.crossed).toBe('soft')
    expect(readJournals()).toHaveLength(1)
  })

  it('aborts at the hard (100%) ceiling and emits a fresh hard event after a soft one', async () => {
    await evaluateCostCap({ ...baseInput, spendUsdOverride: 0.85 })
    expect(readJournals().map((j) => j.type)).toEqual(['cost_threshold_crossed'])

    const hard = await evaluateCostCap({ ...baseInput, spendUsdOverride: 1.05 })
    expect(hard.decision).toBe('abort')
    expect(hard.crossed).toBe('hard')
    // soft + hard — two distinct fires.
    expect(readJournals()).toHaveLength(2)
  })

  it('different wakes track thresholds independently', async () => {
    await evaluateCostCap({ ...baseInput, wakeId: 'w-alpha', spendUsdOverride: 0.9 })
    await evaluateCostCap({ ...baseInput, wakeId: 'w-beta', spendUsdOverride: 0.9 })
    expect(readJournals()).toHaveLength(2)
  })
})
