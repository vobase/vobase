/**
 * Generic agent tools `query_view` and `save_view`.
 *
 * Both wakes (concierge + operator) get these — they're cross-cutting and
 * tied to the saved-views primitive, not to any role-specific behavior.
 *
 * `query_view` runs an ad-hoc query against any registered viewable (no need
 * to save first); `save_view` persists a `SavedViewBody` so the user can pick
 * it back up in the UI.
 */

import { Type } from '@mariozechner/pi-ai'
import { executeQuery, save as saveView } from '@modules/views/service/views'
import type { Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { AgentTool, ToolContext, ToolResult } from '@vobase/core'

const FilterSchema = Type.Object({
  column: Type.String({ minLength: 1 }),
  op: Type.Union([
    Type.Literal('eq'),
    Type.Literal('neq'),
    Type.Literal('in'),
    Type.Literal('not_in'),
    Type.Literal('contains'),
    Type.Literal('gt'),
    Type.Literal('gte'),
    Type.Literal('lt'),
    Type.Literal('lte'),
    Type.Literal('between'),
    Type.Literal('is_null'),
    Type.Literal('is_not_null'),
  ]),
  value: Type.Optional(Type.Unknown()),
})

const SortSchema = Type.Object({
  column: Type.String({ minLength: 1 }),
  direction: Type.Union([Type.Literal('asc'), Type.Literal('desc')]),
})

// ─── query_view ─────────────────────────────────────────────────────────────

export const QueryViewInputSchema = Type.Object({
  scope: Type.String({
    minLength: 1,
    description: 'Viewable scope, e.g. "object:contacts" or "object:messaging".',
  }),
  filters: Type.Optional(Type.Array(FilterSchema)),
  sort: Type.Optional(Type.Array(SortSchema)),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
})

export type QueryViewInput = Static<typeof QueryViewInputSchema>

export const queryViewTool: AgentTool<QueryViewInput, { rows: unknown[]; total: number }> = {
  name: 'query_view',
  description:
    'Query a registered viewable (e.g. object:contacts) with optional filters/sort/pagination. Returns matching rows.',
  inputSchema: QueryViewInputSchema,
  parallelGroup: 'safe',

  async execute(args, _ctx: ToolContext): Promise<ToolResult<{ rows: unknown[]; total: number }>> {
    if (!Value.Check(QueryViewInputSchema, args)) {
      const first = Value.Errors(QueryViewInputSchema, args).First()
      return {
        ok: false,
        error: `Invalid query_view input — ${first ? `${first.path || 'root'}: ${first.message}` : 'unknown'}`,
        errorCode: 'VALIDATION_ERROR',
      }
    }
    try {
      const result = await executeQuery({
        scope: args.scope,
        filters: args.filters,
        sort: args.sort,
        limit: args.limit ?? 50,
        offset: args.offset ?? 0,
      })
      return { ok: true, content: { rows: result.rows, total: result.total } }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'query failed',
        errorCode: 'QUERY_ERROR',
      }
    }
  },
}

// ─── save_view ──────────────────────────────────────────────────────────────

const SavedViewBodyTb = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  kind: Type.Union([
    Type.Literal('table'),
    Type.Literal('kanban'),
    Type.Literal('calendar'),
    Type.Literal('timeline'),
    Type.Literal('gallery'),
    Type.Literal('list'),
  ]),
  columns: Type.Array(Type.String({ minLength: 1 })),
  filters: Type.Optional(Type.Array(FilterSchema)),
  sort: Type.Optional(Type.Array(SortSchema)),
  extras: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

export const SaveViewInputSchema = Type.Object({
  slug: Type.String({
    pattern: '^[a-z0-9-]+$',
    minLength: 1,
    maxLength: 64,
    description: 'Lowercase kebab-case slug, unique within the scope.',
  }),
  scope: Type.String({ minLength: 1, maxLength: 120 }),
  body: SavedViewBodyTb,
})

export type SaveViewInput = Static<typeof SaveViewInputSchema>

export const saveViewTool: AgentTool<SaveViewInput, { id: string; slug: string; scope: string }> = {
  name: 'save_view',
  description: 'Persist a saved view so the user can pick it back up in the UI. Origin auto-set to "agent".',
  inputSchema: SaveViewInputSchema,
  parallelGroup: 'never',

  async execute(args, _ctx: ToolContext): Promise<ToolResult<{ id: string; slug: string; scope: string }>> {
    if (!Value.Check(SaveViewInputSchema, args)) {
      const first = Value.Errors(SaveViewInputSchema, args).First()
      return {
        ok: false,
        error: `Invalid save_view input — ${first ? `${first.path || 'root'}: ${first.message}` : 'unknown'}`,
        errorCode: 'VALIDATION_ERROR',
      }
    }
    try {
      const row = await saveView({
        slug: args.slug,
        scope: args.scope,
        body: args.body,
        origin: 'agent',
      })
      return { ok: true, content: { id: row.id, slug: row.slug, scope: row.scope ?? '' } }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'save failed',
        errorCode: 'SAVE_ERROR',
      }
    }
  },
}

export const sharedViewTools: AgentTool[] = [queryViewTool, saveViewTool]
