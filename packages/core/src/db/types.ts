/**
 * Shared structural type for the minimal Drizzle handle the harness modules
 * (journal, cost, approval-gate) depend on. Each module declares its own
 * narrower chain types ({@link InsertChain}/`SelectChain`/etc.) on top of
 * this base — the umbrella exists so we don't redeclare the
 * `{ select, insert, update }` triple in three places with subtle drift.
 *
 * Permissive on purpose: the chain types narrow to row shapes that vary per
 * module (cost rows have `costUsd`, journal rows have `type`, etc.); only
 * the top-level `select/insert/update` callable shape is shared.
 */

// biome-ignore lint/complexity/noBannedTypes: matches the established cross-module Function-shape pattern
type AnyFn = Function

/**
 * The umbrella structural shape: each module narrows it (e.g. with concrete
 * chain return types) on top. Properties are optional because not every
 * harness consumer needs all three (cost + journal don't `update`).
 */
export interface DrizzleHandleShape {
  select?: AnyFn
  insert?: AnyFn
  update?: AnyFn
}
