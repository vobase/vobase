/**
 * `defineViewable` — register metadata about a Drizzle table so saved views
 * (`object:contacts`, `module:messaging.inbox`, …) can query it through one
 * generic `views.query` RPC.
 *
 * The viewable describes:
 *   - the underlying Drizzle table
 *   - column names, display labels, and types
 *   - which columns are filterable / sortable
 *   - sane defaults shown when no saved view is active
 *
 * Slice 1 keeps the registry minimal — Drizzle's row inference still does
 * the heavy lifting at the call site. Permissions, related-table joins,
 * and computed columns land in later slices.
 */

import type { AnyPgTable } from 'drizzle-orm/pg-core'

export type ViewableColumnType = 'text' | 'number' | 'boolean' | 'date' | 'json' | 'enum'

export interface ViewableColumn {
  name: string
  type: ViewableColumnType
  label?: string
  /** Allowed enum values when `type === 'enum'`. */
  enumValues?: readonly string[]
  filterable?: boolean
  sortable?: boolean
}

export interface ViewableDefaultView {
  columns: string[]
  sort?: ReadonlyArray<{ column: string; direction: 'asc' | 'desc' }>
}

export interface ViewableConfig {
  /**
   * Stable scope id, e.g. `'object:contacts'`. Saved views match by scope;
   * conflicts at registration throw at boot.
   */
  scope: string
  /** Drizzle table the rows live in. */
  table: AnyPgTable
  columns: readonly ViewableColumn[]
  /** Default view shown when no saved view is selected. */
  defaultView: ViewableDefaultView
  /** Optional permission gate (RBAC role list). Empty means everyone. */
  readPermissions?: readonly string[]
}

const VIEWABLES = new Map<string, ViewableConfig>()

export function defineViewable(c: ViewableConfig): ViewableConfig {
  if (!c.scope || /[^a-z0-9_:.-]/i.test(c.scope)) {
    throw new Error(`defineViewable: invalid scope "${c.scope}"`)
  }
  if (VIEWABLES.has(c.scope)) {
    throw new Error(`defineViewable: scope "${c.scope}" already registered`)
  }
  if (!c.columns.length) {
    throw new Error(`defineViewable("${c.scope}"): at least one column required`)
  }
  for (const col of c.columns) {
    if (col.type === 'enum' && !col.enumValues?.length) {
      throw new Error(`defineViewable("${c.scope}"): enum column "${col.name}" needs enumValues`)
    }
  }
  for (const colName of c.defaultView.columns) {
    if (!c.columns.find((col) => col.name === colName)) {
      throw new Error(`defineViewable("${c.scope}"): defaultView references unknown column "${colName}"`)
    }
  }
  VIEWABLES.set(c.scope, c)
  return c
}

export function getViewable(scope: string): ViewableConfig | undefined {
  return VIEWABLES.get(scope)
}

export function listViewables(): readonly ViewableConfig[] {
  return [...VIEWABLES.values()]
}

/** Test-only — production code never calls this. */
export function __resetViewablesForTests(): void {
  VIEWABLES.clear()
}

/**
 * Validate a filter list against a viewable's column metadata. Returns
 * a list of issues (empty when the filter set is acceptable).
 *
 * Operators allowed per type:
 *   text/json:    eq, neq, contains, in, not_in, is_null, is_not_null
 *   number/date:  eq, neq, gt, gte, lt, lte, between, is_null, is_not_null
 *   boolean:      eq, neq, is_null, is_not_null
 *   enum:         eq, neq, in, not_in, is_null, is_not_null
 */
export function validateFilters(
  config: ViewableConfig,
  filters: ReadonlyArray<{ column: string; op: string; value?: unknown }>,
): string[] {
  const issues: string[] = []
  const byName = new Map(config.columns.map((c) => [c.name, c]))
  for (const f of filters) {
    const col = byName.get(f.column)
    if (!col) {
      issues.push(`unknown column "${f.column}"`)
      continue
    }
    if (col.filterable === false) {
      issues.push(`column "${f.column}" is not filterable`)
      continue
    }
    if (!OPERATOR_MATRIX[col.type].includes(f.op)) {
      issues.push(`operator "${f.op}" not valid for column type "${col.type}"`)
    }
  }
  return issues
}

const OPERATOR_MATRIX: Record<ViewableColumnType, readonly string[]> = {
  text: ['eq', 'neq', 'contains', 'in', 'not_in', 'is_null', 'is_not_null'],
  json: ['eq', 'neq', 'contains', 'in', 'not_in', 'is_null', 'is_not_null'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
  boolean: ['eq', 'neq', 'is_null', 'is_not_null'],
  enum: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
}
