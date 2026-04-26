/**
 * `saved_views` — the first concrete declarative-resource consumer.
 *
 * One row per saved view. The body is a `SavedViewBody` JSONB describing
 * which renderer to use, which columns to show, the active filter+sort, and
 * any renderer-specific extras (kanban group-by column, calendar date
 * field, etc.). `scope` partitions views by viewable id (e.g.
 * `object:contacts`, `object:messaging`).
 *
 * Each tenant's project is single-tenant, so no `organizationId`. The
 * standard `Authored<T>` columns track `(slug, scope)` as the unique
 * identity, plus the `origin` / file-source provenance the reconciler
 * relies on.
 */

import { authoredColumns, authoredConstraints } from '@vobase/core/schema'
import type { InferSelectModel } from 'drizzle-orm'

import { viewsPgSchema } from '~/runtime'

export type ViewKind = 'table' | 'kanban' | 'calendar' | 'timeline' | 'gallery' | 'list'

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'is_null'
  | 'is_not_null'

export interface ViewFilter {
  column: string
  op: FilterOperator
  value?: unknown
}

export interface ViewSort {
  column: string
  direction: 'asc' | 'desc'
}

export interface SavedViewBody {
  /** Display name shown in the view picker. */
  name: string
  /** Renderer kind. */
  kind: ViewKind
  /** Columns visible in the view, in display order. */
  columns: string[]
  filters?: ViewFilter[]
  sort?: ViewSort[]
  /** Renderer-specific extras (e.g. `{ groupByColumn: 'status' }` for kanban). */
  extras?: Record<string, unknown>
}

export const savedViews = viewsPgSchema.table('saved_views', authoredColumns<SavedViewBody>(), (_t) =>
  authoredConstraints('saved_views'),
)

export type SavedViewRow = InferSelectModel<typeof savedViews>
