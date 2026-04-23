/**
 * contacts module state — no status transitions on contacts in Phase 1.
 * Stub to satisfy module-shape contract.
 */
import type { TransitionTable } from '@server/common/apply-transition'

export const contactTransitions: TransitionTable<string> = {
  transitions: [],
  terminal: [],
}
