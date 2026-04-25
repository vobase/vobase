/**
 * team module state — `availability` is a column-level CHECK, not a tracked
 * state machine. Stub table to satisfy the module-shape contract.
 */
import type { TransitionTable } from '~/runtime'

export const teamTransitions: TransitionTable<string> = {
  transitions: [],
  terminal: [],
}
