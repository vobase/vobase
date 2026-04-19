export interface IterationBudget {
  maxTurnsPerWake: number
  softCostCeilingUsd: number
  hardCostCeilingUsd: number
  /** Upper bound on output tokens per LLM call — used for worst-case-delta pre-turn check. */
  maxOutputTokens: number
  /** Upper bound on input tokens per LLM call — used for worst-case-delta pre-turn check. */
  maxInputTokens: number
}

export type BudgetPhase = 'soft' | 'hard'

export interface BudgetState {
  turnsConsumed: number
  spentUsd: number
}
