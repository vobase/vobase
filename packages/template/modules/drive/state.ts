/**
 * drive module state — no status transitions on drive files in Phase 1.
 * Stub to satisfy module-shape contract.
 */
import type { TransitionTable } from '~/runtime'

export const driveTransitions: TransitionTable<string> = {
  transitions: [],
  terminal: [],
}

/**
 * Lifecycle columns for a row whose body is *already* the extracted form
 * (text writes via `writePath`, the proposal materializer's `upsertFile`,
 * and seeded markdown). Reset all three so an accepted text write recovers
 * a row a prior `reextract` flipped to `(failed, failed)`.
 */
export const TEXT_WRITE_LIFECYCLE = {
  processingStatus: 'ready',
  extractionKind: 'extracted',
  processingError: null,
} as const
