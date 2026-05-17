/**
 * RecentRunsTable — 24h history of `automation_runs` joined with the per-wake
 * cost rollup from `harness.conversation_events`. Sortable by cost descending.
 */

import {
  type ColumnDef,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { Clock } from 'lucide-react'
import { useMemo, useState } from 'react'

import { DataTable } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { Status } from '@/components/ui/status'
import { type RunRow, useActivityRuns } from '../hooks/use-activity'

function runStatusVariant(s: string): React.ComponentProps<typeof Status>['variant'] {
  if (s === 'succeeded') return 'success'
  if (s === 'failed') return 'failed'
  if (s.startsWith('suppressed')) return 'warning'
  if (s === 'queued') return 'info'
  return 'neutral'
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtUsd(n: number): string {
  return n > 0 ? `$${n.toFixed(4)}` : '—'
}

export function RecentRunsTable() {
  const { data: rows = [], isLoading } = useActivityRuns()

  const [sorting, setSorting] = useState<SortingState>([{ id: 'startedAt', desc: true }])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 })

  const columns = useMemo<ColumnDef<RunRow>[]>(
    () => [
      {
        id: 'ruleName',
        accessorKey: 'ruleName',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Rule" />,
        cell: ({ row }) => (
          <span className="font-medium text-foreground text-sm">{row.original.ruleName ?? row.original.ruleId}</span>
        ),
        meta: { label: 'Rule', variant: 'text', placeholder: 'Search rule…' },
        enableColumnFilter: true,
        enableSorting: true,
      },
      {
        id: 'eventName',
        accessorKey: 'eventName',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Event" />,
        cell: ({ row }) => <span className="font-mono text-muted-foreground text-xs">{row.original.eventName}</span>,
        enableSorting: true,
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Status" />,
        cell: ({ row }) => <Status variant={runStatusVariant(row.original.status)} label={row.original.status} />,
        enableSorting: true,
      },
      {
        id: 'startedAt',
        accessorKey: 'startedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Started" />,
        cell: ({ row }) => <RelativeTimeCard date={row.original.startedAt} />,
        enableSorting: true,
      },
      {
        id: 'finishedAt',
        accessorKey: 'finishedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Finished" />,
        cell: ({ row }) =>
          row.original.finishedAt ? (
            <RelativeTimeCard date={row.original.finishedAt} />
          ) : (
            <span className="text-muted-foreground/60">—</span>
          ),
        enableSorting: true,
      },
      {
        id: 'durationMs',
        accessorKey: 'durationMs',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Duration" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs tabular-nums">{fmtDuration(row.original.durationMs)}</span>
        ),
        enableSorting: true,
      },
      {
        id: 'costUsd',
        accessorKey: 'costUsd',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Cost" />,
        cell: ({ row }) => <span className="text-foreground text-xs tabular-nums">{fmtUsd(row.original.costUsd)}</span>,
        sortDescFirst: true,
        enableSorting: true,
      },
      {
        id: 'wakeId',
        accessorKey: 'wakeId',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Wake" />,
        cell: ({ row }) =>
          row.original.wakeId ? (
            <span className="font-mono text-muted-foreground text-xs">{row.original.wakeId.slice(0, 8)}</span>
          ) : (
            <span className="text-muted-foreground/60">—</span>
          ),
        enableSorting: false,
      },
    ],
    [],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  if (isLoading) return <DataTableSkeleton columnCount={columns.length} filterCount={1} />

  if (rows.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia>
            <Clock className="size-5" />
          </EmptyMedia>
          <EmptyTitle>No runs in the last 24 hours</EmptyTitle>
          <EmptyDescription>Runs appear once a producer module emits an event into the bus.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  )
}
