import type { BudgetPhase, BudgetState, IterationBudget } from '@server/contracts/iteration-budget'

/**
 * Returns the breach phase if any threshold is crossed, or `null` if within budget.
 *
 * Hard triggers: turnsConsumed >= maxTurnsPerWake OR spentUsd >= hardCostCeilingUsd.
 * Soft triggers: turnsConsumed >= 70% of maxTurnsPerWake OR spentUsd >= softCostCeilingUsd.
 * Hard is checked first so the return value is always the most severe phase.
 */
export function assessBudget(budget: IterationBudget, state: BudgetState): BudgetPhase | null {
  const softTurnThreshold = Math.ceil(budget.maxTurnsPerWake * 0.7)

  if (state.turnsConsumed >= budget.maxTurnsPerWake) return 'hard'
  if (budget.hardCostCeilingUsd > 0 && state.spentUsd >= budget.hardCostCeilingUsd) return 'hard'

  if (state.turnsConsumed >= softTurnThreshold) return 'soft'
  if (budget.softCostCeilingUsd > 0 && state.spentUsd >= budget.softCostCeilingUsd) return 'soft'

  return null
}

/**
 * Returns true if the worst-case cost of the next turn (maxInputTokens * costIn +
 * maxOutputTokens * costOut) would push currentSpend over the hard ceiling.
 *
 * Called pre-turn so the harness can refuse the turn before issuing the LLM request.
 * Returns false when no ceiling is configured (hardCostCeilingUsd <= 0) or when
 * per-token cost estimates are both zero (no data yet from a previous turn).
 */
export function worstCaseDeltaExceeds(
  budget: IterationBudget,
  currentSpend: number,
  costPerInputToken: number,
  costPerOutputToken: number,
): boolean {
  if (budget.hardCostCeilingUsd <= 0) return false
  const delta = budget.maxInputTokens * costPerInputToken + budget.maxOutputTokens * costPerOutputToken
  return currentSpend + delta > budget.hardCostCeilingUsd
}
