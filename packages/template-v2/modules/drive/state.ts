/**
 * drive module state — no status transitions on drive files in Phase 1.
 * Stub to satisfy module-shape contract.
 */
import type { TransitionTable } from '@server/common/apply-transition'

export const driveTransitions: TransitionTable<string> = {
  transitions: [],
  terminal: [],
}
