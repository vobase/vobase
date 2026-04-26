/**
 * `<ViewRenderer scope=... slug=... />` — server-driven saved-view shell.
 *
 * Fetches a `SavedViewBody` (when `slug` is provided) plus the row payload
 * via `viewsClient.query.$post` and renders the result for the table kind.
 * Filter/sort/page state lives in the URL via nuqs so the saved-view link is
 * shareable; non-table kinds (kanban / calendar / timeline / gallery / list)
 * are wired as extension points but render an Empty placeholder until each
 * kind ships its own renderer.
 *
 * Runtime contract: `viewsClient` is a typed Hono RPC client; the page never
 * dives into the underlying Drizzle schema.
 */

import { useQuery } from '@tanstack/react-query'
import { type ColumnDef, flexRender, getCoreRowModel, type SortingState, useReactTable } from '@tanstack/react-table'
import { parseAsInteger, parseAsJson, parseAsString, useQueryStates } from 'nuqs'
import * as React from 'react'

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { viewsClient } from '@/lib/api-client'

const DEFAULT_LIMIT = 50
const VIEW_KINDS = ['table', 'kanban', 'calendar', 'timeline', 'gallery', 'list'] as const
export type ViewKind = (typeof VIEW_KINDS)[number]

interface ViewFilter {
  column: string
  op: 'eq' | 'neq' | 'in' | 'not_in' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'is_null' | 'is_not_null'
  value?: unknown
}

interface ViewSort {
  column: string
  direction: 'asc' | 'desc'
}

interface SavedViewBody {
  name: string
  kind: ViewKind
  columns: string[]
  filters?: ViewFilter[]
  sort?: ViewSort[]
}

export interface ViewRendererProps<TRow extends Record<string, unknown> = Record<string, unknown>> {
  /** Viewable scope, e.g. `'object:contacts'`. */
  scope: string
  /** Optional saved-view slug — when omitted, the viewable's defaultView is used. */
  slug?: string
  /**
   * Per-column overrides. Keys are column names from `SavedViewBody.columns`;
   * values supply custom `cell` / `header` renderers when the default
   * (string-coercion in a div) isn't enough.
   */
  columnOverrides?: Partial<Record<string, Partial<ColumnDef<TRow>>>>
  /** Render slot above the table (header, action buttons, filters). */
  toolbar?: React.ReactNode
  className?: string
}

/**
 * Coerces nuqs URL state into the `SavedViewBody` shape expected by the
 * server. Filters/sort are passed as JSON strings; numeric coercions happen
 * here so the table receives ready-to-use values.
 */
function readUrlState() {
  return {
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(DEFAULT_LIMIT),
    sortColumn: parseAsString,
    sortDirection: parseAsString,
    filters: parseAsJson<ViewFilter[]>((v) => (Array.isArray(v) ? (v as ViewFilter[]) : [])),
  }
}

export function ViewRenderer<TRow extends Record<string, unknown> = Record<string, unknown>>({
  scope,
  slug,
  columnOverrides,
  toolbar,
  className,
}: ViewRendererProps<TRow>) {
  const [urlState, setUrlState] = useQueryStates(readUrlState(), { history: 'replace' })

  const savedViewQuery = useQuery({
    queryKey: ['saved-views', scope, slug ?? '__default__'],
    enabled: Boolean(slug),
    queryFn: async (): Promise<SavedViewBody | null> => {
      if (!slug) return null
      const r = await viewsClient[':slug'].$get({ param: { slug }, query: { scope } })
      if (r.status === 404) return null
      if (!r.ok) throw new Error('Failed to load saved view')
      const row = (await r.json()) as { body: SavedViewBody } | null
      return row?.body ?? null
    },
  })

  const savedView = savedViewQuery.data ?? null

  const effectiveSort = React.useMemo<ViewSort[]>(() => {
    if (urlState.sortColumn && urlState.sortDirection) {
      const dir = urlState.sortDirection === 'desc' ? 'desc' : 'asc'
      return [{ column: urlState.sortColumn, direction: dir }]
    }
    return savedView?.sort ?? []
  }, [savedView, urlState.sortColumn, urlState.sortDirection])

  const effectiveFilters = React.useMemo<ViewFilter[]>(() => {
    return urlState.filters ?? savedView?.filters ?? []
  }, [savedView, urlState.filters])

  const rowsQuery = useQuery({
    queryKey: ['view-rows', scope, slug ?? null, effectiveSort, effectiveFilters, urlState.page, urlState.pageSize],
    queryFn: async () => {
      const limit = urlState.pageSize ?? DEFAULT_LIMIT
      const offset = ((urlState.page ?? 1) - 1) * limit
      const r = await viewsClient.query.$post({
        json: { scope, filters: effectiveFilters, sort: effectiveSort, limit, offset },
      })
      if (!r.ok) throw new Error('Failed to load rows')
      return (await r.json()) as { scope: string; rows: TRow[]; total: number }
    },
  })

  const kind = savedView?.kind ?? 'table'
  const columnNames = savedView?.columns ?? []

  // ── Table-kind rendering ────────────────────────────────────────────────────
  const columnDefs = React.useMemo<ColumnDef<TRow>[]>(
    () =>
      columnNames.map((name) => ({
        id: name,
        accessorKey: name,
        header: () => <span className="font-medium text-sm">{humanize(name)}</span>,
        cell: ({ row }) => {
          const raw = (row.original as Record<string, unknown>)[name]
          return <span className="text-sm">{stringifyCell(raw)}</span>
        },
        ...(columnOverrides?.[name] ?? {}),
      })),
    [columnNames, columnOverrides],
  )

  const sortingState = React.useMemo<SortingState>(
    () => (effectiveSort[0] ? [{ id: effectiveSort[0].column, desc: effectiveSort[0].direction === 'desc' }] : []),
    [effectiveSort],
  )

  const table = useReactTable<TRow>({
    data: rowsQuery.data?.rows ?? [],
    columns: columnDefs,
    state: { sorting: sortingState },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sortingState) : updater
      const head = next[0]
      void setUrlState({
        sortColumn: head?.id ?? null,
        sortDirection: head ? (head.desc ? 'desc' : 'asc') : null,
      })
    },
    manualSorting: true,
    manualPagination: true,
    manualFiltering: true,
    getCoreRowModel: getCoreRowModel(),
  })

  if (kind !== 'table') {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{titleCase(kind)} view not implemented yet</EmptyTitle>
          <EmptyDescription>
            This saved view requested kind <code>{kind}</code>. Only <code>table</code> is wired today; other kinds ship
            as <code>{'<ViewRenderer>'}</code> dispatchers in a follow-up slice.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (rowsQuery.isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Failed to load view</EmptyTitle>
          <EmptyDescription>{(rowsQuery.error as Error).message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className={className ?? 'flex w-full flex-col gap-2.5'}>
      {toolbar}
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rowsQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={columnDefs.length || 1} className="h-24 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columnDefs.length || 1} className="h-24 text-center text-muted-foreground">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function humanize(s: string): string {
  return s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
