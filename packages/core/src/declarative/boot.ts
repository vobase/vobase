/**
 * `bootDeclarativeResources` — invoke once at app boot, after all modules
 * have registered their declarative resources via `defineDeclarativeResource`
 * and bound their tables via `bindDeclarativeTable`.
 *
 * The bind step is what lets a resource declaration in core line up with the
 * concrete Drizzle table the template module owns: each module imports
 * `bindDeclarativeTable(kind, table)` from its `init` (or schema-time
 * registration) so the reconciler driver knows which table to read/write
 * for a given `kind`.
 */

import type { AnyPgTable } from 'drizzle-orm/pg-core'

import { listDeclarativeResources } from './define'
import { type ReconcilerDb, reconcileResource } from './reconcile'
import { buildRefGraph } from './refgraph'
import type { ReconcileDiff } from './types'

const TABLE_BINDINGS = new Map<string, AnyPgTable>()

/**
 * Bind a Drizzle table to a registered resource kind. Call from module init
 * (or top-level alongside the resource definition). Throws if the resource
 * isn't registered or if the binding already exists.
 */
export function bindDeclarativeTable(kind: string, table: AnyPgTable): void {
  if (TABLE_BINDINGS.has(kind)) {
    throw new Error(`bindDeclarativeTable: kind "${kind}" already bound`)
  }
  TABLE_BINDINGS.set(kind, table)
}

export function getDeclarativeTable(kind: string): AnyPgTable | undefined {
  return TABLE_BINDINGS.get(kind)
}

export function __resetDeclarativeBindingsForTests(): void {
  TABLE_BINDINGS.clear()
}

export interface BootDeclarativeResourcesOpts {
  db: ReconcilerDb
  /** Repo root the reconciler globs from. Usually `process.cwd()` for the template. */
  rootDir: string
  log?: (msg: string, meta?: Record<string, unknown>) => void
}

export interface BootDeclarativeResourcesResult {
  diffs: ReadonlyArray<ReconcileDiff>
  refGraph: { resolved: number; dangling: number; deactivated: number }
}

/**
 * Run reconcile for every registered resource, then resolve the reference
 * graph. Idempotent: a second call with no source changes is a hash-compare
 * tour with zero writes.
 */
export async function bootDeclarativeResources(
  opts: BootDeclarativeResourcesOpts,
): Promise<BootDeclarativeResourcesResult> {
  const diffs: ReconcileDiff[] = []
  for (const resource of listDeclarativeResources()) {
    const table = TABLE_BINDINGS.get(resource.kind)
    if (!table) {
      opts.log?.(`bootDeclarativeResources: skipping kind "${resource.kind}" — no table bound`, {
        kind: resource.kind,
      })
      continue
    }
    const diff = await reconcileResource({ db: opts.db, rootDir: opts.rootDir, log: opts.log }, { resource, table })
    diffs.push(diff)
  }
  const refGraph = await buildRefGraph({ db: opts.db, log: opts.log })
  return { diffs, refGraph }
}
