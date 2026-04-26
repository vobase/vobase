/**
 * Reference-integrity graph.
 *
 * Resources reference each other by `(kind, slug, scope?)` — e.g. an
 * agent definition lists skills it loads; a schedule names a saved view it
 * queries. A reference declaration in body is opaque to core; consumers tell
 * the graph builder how to extract refs from a body via `extractRefs`.
 *
 * After boot reconcile completes, the graph runs over every active row,
 * resolves declared refs against the registry, and either:
 *   - logs a `reference_dangling` audit row (severity: warn) if the target
 *     row doesn't exist, OR
 *   - flips `active = false` on the source row if `policy === 'deactivate'`.
 *
 * For Slice 1 the graph is a no-op stub — saved views don't reference other
 * resources. Real wiring lands when agent_skills + agent_definitions migrate
 * (Phase 3).
 */

import type { AnyPgTable } from 'drizzle-orm/pg-core'

import type { Authored, DeclarativeResource } from './types'

export interface ResourceRef {
  kind: string
  slug: string
  scope: string | null
}

export interface RefGraphContributor<TBody> {
  resource: DeclarativeResource<TBody>
  table: AnyPgTable
  extractRefs: (body: TBody) => readonly ResourceRef[]
  /** What to do when a reference target is missing. */
  policy?: 'audit-only' | 'deactivate'
}

const CONTRIBUTORS: RefGraphContributor<unknown>[] = []

export function registerRefGraphContributor<TBody>(c: RefGraphContributor<TBody>): void {
  CONTRIBUTORS.push(c as unknown as RefGraphContributor<unknown>)
}

export function listRefGraphContributors(): readonly RefGraphContributor<unknown>[] {
  return [...CONTRIBUTORS]
}

export function __resetRefGraphForTests(): void {
  CONTRIBUTORS.length = 0
}

/**
 * Build the forward-reference graph and resolve dangling targets.
 *
 * Implementation deferred — this stub is wired into `bootDeclarativeResources`
 * so the call-site stays stable when real consumers register contributors.
 */
export interface BuildRefGraphDeps {
  db: unknown
  log?: (msg: string, meta?: Record<string, unknown>) => void
}

export interface RefGraphResult {
  resolved: number
  dangling: number
  deactivated: number
}

export async function buildRefGraph(deps: BuildRefGraphDeps): Promise<RefGraphResult> {
  void deps
  // No active contributors yet (Slice 1): zero dangling, zero deactivations.
  return { resolved: 0, dangling: 0, deactivated: 0 }
}

// Unused-import keeper; the type is part of the public-API surface and will
// be referenced once contributors land.
export type { Authored }
