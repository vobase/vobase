import { describe, expect, it } from 'bun:test'
import type { BudgetState, IterationBudget } from '@server/contracts/iteration-budget'
import { assessBudget, worstCaseDeltaExceeds } from './iteration-budget-runtime'

const budget: IterationBudget = {
  maxTurnsPerWake: 10,
  softCostCeilingUsd: 0.07,
  hardCostCeilingUsd: 0.1,
  maxOutputTokens: 4096,
  maxInputTokens: 32768,
}

describe('assessBudget', () => {
  it('returns null within budget', () => {
    const state: BudgetState = { turnsConsumed: 3, spentUsd: 0.02 }
    expect(assessBudget(budget, state)).toBe(null)
  })

  it('returns soft at ≥70% of turns (7 of 10 → ceil(10*0.7)=7)', () => {
    const state: BudgetState = { turnsConsumed: 7, spentUsd: 0.01 }
    expect(assessBudget(budget, state)).toBe('soft')
  })

  it('returns soft at ≥softCostCeilingUsd', () => {
    const state: BudgetState = { turnsConsumed: 1, spentUsd: 0.07 }
    expect(assessBudget(budget, state)).toBe('soft')
  })

  it('returns hard at ≥maxTurnsPerWake', () => {
    const state: BudgetState = { turnsConsumed: 10, spentUsd: 0.01 }
    expect(assessBudget(budget, state)).toBe('hard')
  })

  it('returns hard at ≥hardCostCeilingUsd', () => {
    const state: BudgetState = { turnsConsumed: 2, spentUsd: 0.1 }
    expect(assessBudget(budget, state)).toBe('hard')
  })

  it('hard takes precedence over soft', () => {
    const state: BudgetState = { turnsConsumed: 10, spentUsd: 0.1 }
    expect(assessBudget(budget, state)).toBe('hard')
  })

  it('no ceiling configured (zero) → cost check skipped', () => {
    const noCeiling: IterationBudget = { ...budget, hardCostCeilingUsd: 0, softCostCeilingUsd: 0 }
    const state: BudgetState = { turnsConsumed: 1, spentUsd: 9999 }
    expect(assessBudget(noCeiling, state)).toBe(null)
  })
})

describe('worstCaseDeltaExceeds', () => {
  it('returns false when no ceiling configured', () => {
    const noCeiling: IterationBudget = { ...budget, hardCostCeilingUsd: 0 }
    expect(worstCaseDeltaExceeds(noCeiling, 0, 0.001, 0.003)).toBe(false)
  })

  it('returns false when projected spend is within ceiling', () => {
    // delta = 32768 * 0.0000001 + 4096 * 0.0000002 = 0.003277 + 0.000819 = 0.004096
    // 0.05 + 0.004096 = 0.054 < 0.10 → false
    expect(worstCaseDeltaExceeds(budget, 0.05, 0.0000001, 0.0000002)).toBe(false)
  })

  it('returns true when projected spend exceeds ceiling', () => {
    // delta = 32768 * 0.000001 + 4096 * 0.000003 = 0.032768 + 0.012288 = 0.045056
    // 0.09 + 0.045056 = 0.135 > 0.10 → true
    expect(worstCaseDeltaExceeds(budget, 0.09, 0.000001, 0.000003)).toBe(true)
  })

  it('returns false when both per-token rates are zero', () => {
    expect(worstCaseDeltaExceeds(budget, 0.09, 0, 0)).toBe(false)
  })
})
