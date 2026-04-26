/**
 * Table-binding registry for declarative resources.
 *
 * Slice 1 of the `external-cli-and-collapse-shell` change tore down the boot
 * reconciler — drift detection, the audit log, the refgraph, and the
 * automatic boot scan all collapsed onto an explicit `vobase install
 * --defaults` flow (see Slice 3). What remains is the static binding from
 * `kind` → Drizzle table so future install handlers can locate the table
 * without re-deriving it.
 */

import type { AnyPgTable } from 'drizzle-orm/pg-core'

const TABLE_BINDINGS = new Map<string, AnyPgTable>()

/**
 * Bind a Drizzle table to a registered resource kind. Call from module init
 * (or top-level alongside the resource definition). Throws if the binding
 * already exists.
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
