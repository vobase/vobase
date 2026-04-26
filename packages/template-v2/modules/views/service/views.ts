/**
 * Views service — the only writer for `saved_views`.
 *
 * Responsibilities:
 *   - CRUD over the saved-views row shape (`Authored<SavedViewBody>`).
 *   - `executeQuery({scope, filters, sort, limit})` — generic dispatch onto
 *     the underlying viewable's table, applying filters/sort/limit.
 *
 * The runtime CRUD path always sets `origin = 'user'` (or `'agent'` if the
 * caller is an agent tool) — that's what protects mutations from being
 * clobbered by the next boot reconcile pass.
 */

import { type SavedViewBody, type SavedViewRow, savedViews } from '@modules/views/schema'
import type { Origin } from '@vobase/core'
import {
  getViewable,
  notFound,
  type ViewableColumn,
  type ViewableConfig,
  validateFilters,
  validation,
} from '@vobase/core'
import { and, asc, desc, eq, getTableColumns, isNotNull, isNull, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { z } from 'zod'

import type { ScopedDb } from '~/runtime'

export interface ViewsDeps {
  db: ScopedDb
}

export const filterSchema = z.object({
  column: z.string().min(1),
  op: z.enum(['eq', 'neq', 'in', 'not_in', 'contains', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null']),
  value: z.unknown().optional(),
})

export const sortSchema = z.object({
  column: z.string().min(1),
  direction: z.enum(['asc', 'desc']),
})

export const savedViewBodySchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['table', 'kanban', 'calendar', 'timeline', 'gallery', 'list']),
  columns: z.array(z.string().min(1)).min(1),
  filters: z.array(filterSchema).optional(),
  sort: z.array(sortSchema).optional(),
  extras: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<SavedViewBody>

export interface SaveViewInput {
  slug: string
  scope: string
  body: SavedViewBody
  origin?: Origin
  ownerStaffId?: string | null
}

export interface QueryInput {
  scope: string
  filters?: ReadonlyArray<z.infer<typeof filterSchema>>
  sort?: ReadonlyArray<z.infer<typeof sortSchema>>
  limit?: number
  offset?: number
}

export interface QueryResult<TRow = Record<string, unknown>> {
  scope: string
  rows: TRow[]
  total: number
}

export interface ViewsService {
  list(scope?: string): Promise<SavedViewRow[]>
  get(slug: string, scope: string): Promise<SavedViewRow | null>
  save(input: SaveViewInput): Promise<SavedViewRow>
  remove(slug: string, scope: string): Promise<void>
  executeQuery(input: QueryInput): Promise<QueryResult>
}

export function createViewsService(deps: ViewsDeps): ViewsService {
  const db = deps.db

  async function list(scope?: string): Promise<SavedViewRow[]> {
    const where =
      scope === undefined ? eq(savedViews.active, true) : and(eq(savedViews.scope, scope), eq(savedViews.active, true))
    const rows = await db.select().from(savedViews).where(where)
    return rows as SavedViewRow[]
  }

  async function get(slug: string, scope: string): Promise<SavedViewRow | null> {
    const rows = (await db
      .select()
      .from(savedViews)
      .where(and(eq(savedViews.slug, slug), eq(savedViews.scope, scope)))
      .limit(1)) as SavedViewRow[]
    return rows[0] ?? null
  }

  async function save(input: SaveViewInput): Promise<SavedViewRow> {
    savedViewBodySchema.parse(input.body)
    const viewable = getViewable(input.scope)
    if (viewable && input.body.filters) {
      const issues = validateFilters(viewable, input.body.filters)
      if (issues.length) throw validation({ filters: issues }, `saveView: filter issues — ${issues.join('; ')}`)
    }

    const existing = await get(input.slug, input.scope)
    if (existing) {
      await db
        .update(savedViews)
        .set({
          body: input.body,
          origin: input.origin ?? 'user',
          ownerStaffId: input.ownerStaffId ?? existing.ownerStaffId,
          active: true,
        })
        .where(eq(savedViews.id, existing.id))
      const refreshed = await get(input.slug, input.scope)
      if (!refreshed) throw new Error('saveView: row vanished post-update')
      return refreshed
    }

    const inserted = (await db
      .insert(savedViews)
      .values({
        slug: input.slug,
        scope: input.scope,
        body: input.body,
        origin: input.origin ?? 'user',
        fileSourcePath: null,
        fileContentHash: null,
        ownerStaffId: input.ownerStaffId ?? null,
        active: true,
      })
      .returning()) as SavedViewRow[]
    if (!inserted[0]) throw new Error('saveView: insert returned no row')
    return inserted[0]
  }

  async function remove(slug: string, scope: string): Promise<void> {
    await db
      .update(savedViews)
      .set({ active: false })
      .where(and(eq(savedViews.slug, slug), eq(savedViews.scope, scope)))
  }

  async function executeQuery(input: QueryInput): Promise<QueryResult> {
    const viewable = getViewable(input.scope)
    if (!viewable) throw notFound(`view scope "${input.scope}"`)

    const filters = input.filters ?? []
    const issues = validateFilters(viewable, filters)
    if (issues.length) throw validation({ filters: issues }, `views.query: ${issues.join('; ')}`)

    const cols = getTableColumns(viewable.table) as Record<string, AnyPgColumn>
    const wherePieces = filters.map((f) => buildFilter(cols, viewable, f))
    const where = wherePieces.length === 1 ? wherePieces[0] : wherePieces.length ? and(...wherePieces) : undefined

    const sortBy = (input.sort ?? viewable.defaultView.sort ?? []).map((s) => {
      const col = cols[s.column]
      if (!col) throw validation({ column: s.column }, `views.query: unknown sort column "${s.column}"`)
      return s.direction === 'asc' ? asc(col) : desc(col)
    })

    const limit = Math.max(1, Math.min(input.limit ?? 100, 500))
    const offset = Math.max(0, input.offset ?? 0)

    let q = db.select().from(viewable.table).$dynamic()
    if (where) q = q.where(where)
    for (const o of sortBy) q = q.orderBy(o)
    q = q.limit(limit).offset(offset)

    let countQ = db.select({ n: sql<number>`count(*)::int` }).from(viewable.table).$dynamic()
    if (where) countQ = countQ.where(where)

    const [rows, countRows] = await Promise.all([q, countQ])
    const total = countRows[0]?.n ?? 0

    return { scope: input.scope, rows: rows as Record<string, unknown>[], total }
  }

  return { list, get, save, remove, executeQuery }
}

function buildFilter(cols: Record<string, AnyPgColumn>, viewable: ViewableConfig, f: z.infer<typeof filterSchema>) {
  const col = cols[f.column]
  if (!col) throw validation({ column: f.column }, `views.query: unknown filter column "${f.column}"`)
  const meta = viewable.columns.find((c: ViewableColumn) => c.name === f.column)
  switch (f.op) {
    case 'eq':
      return eq(col, f.value as never)
    case 'neq':
      return sql`${col} <> ${f.value}`
    case 'gt':
      return sql`${col} > ${f.value}`
    case 'gte':
      return sql`${col} >= ${f.value}`
    case 'lt':
      return sql`${col} < ${f.value}`
    case 'lte':
      return sql`${col} <= ${f.value}`
    case 'between': {
      const arr = Array.isArray(f.value) ? f.value : []
      if (arr.length !== 2) throw validation({ column: f.column }, `views.query: between needs [from, to]`)
      return sql`${col} BETWEEN ${arr[0]} AND ${arr[1]}`
    }
    case 'in':
      return sql`${col} = ANY(${Array.isArray(f.value) ? f.value : []})`
    case 'not_in':
      return sql`NOT (${col} = ANY(${Array.isArray(f.value) ? f.value : []}))`
    case 'contains': {
      // text only — matrix already gated this via validateFilters.
      void meta
      return sql`${col}::text ILIKE ${`%${String(f.value ?? '')}%`}`
    }
    case 'is_null':
      return isNull(col)
    case 'is_not_null':
      return isNotNull(col)
    default: {
      const exhaustive: never = f.op
      throw new Error(`views.query: unsupported op "${String(exhaustive)}"`)
    }
  }
}

// ─── Service install/dispatch (matches contacts/team service shape) ─────────

let _current: ViewsService | null = null
export function installViewsService(svc: ViewsService): void {
  _current = svc
}
function current(): ViewsService {
  if (!_current) throw new Error('views: service not installed — call installViewsService() in module init')
  return _current
}
export const list = (scope?: string) => current().list(scope)
export const get = (slug: string, scope: string) => current().get(slug, scope)
export const save = (input: SaveViewInput) => current().save(input)
export const remove = (slug: string, scope: string) => current().remove(slug, scope)
export const executeQuery = (input: QueryInput) => current().executeQuery(input)
