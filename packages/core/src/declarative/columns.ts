/**
 * Reusable Drizzle column set for `Authored<T>` rows.
 *
 * Spread the result of `authoredColumns()` into a `pgSchema.table()`
 * definition to get the standard slug / scope / body / origin tracking
 * columns. Consumers add a typed `body` jsonb cast and any domain-specific
 * extra columns alongside.
 */

import { sql } from 'drizzle-orm'
import { check, jsonb, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { DEFAULT_COLUMNS, nanoidPrimaryKey } from '../db/helpers'

export interface AuthoredColumnsOpts<TBody = unknown> {
  /** Cast for the `body` JSONB. Defaults to `unknown`; pass your shape for inference. */
  bodyType?: () => TBody
}

/**
 * Standard column set for an Authored<T> table. Spread into the column map:
 *
 *   pgSchema.table('skills', { ...authoredColumns<SkillBody>() })
 */
export function authoredColumns<TBody = unknown>(_opts: AuthoredColumnsOpts<TBody> = {}) {
  return {
    id: nanoidPrimaryKey(),
    slug: text('slug').notNull(),
    scope: text('scope'),
    body: jsonb('body').$type<TBody>().notNull(),
    origin: text('origin').notNull().default('file'),
    ownerStaffId: text('owner_staff_id'),
    ...DEFAULT_COLUMNS,
  }
}

/**
 * Default constraints to add alongside `authoredColumns()` — origin enum
 * check + unique (slug, scope) index. Consumers compose into their own
 * extras list.
 */
export function authoredConstraints(tableName: string) {
  return [
    check(`${tableName}_origin_check`, sql`origin IN ('file','user','agent')`),
    uniqueIndex(`uq_${tableName}_slug_scope`).on(sql.raw('slug'), sql.raw("coalesce(scope, '')")),
  ]
}
