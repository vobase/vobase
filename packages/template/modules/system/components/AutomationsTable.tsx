/**
 * AutomationsTable — DiceUI DataTable showing the per-rule status with
 * pause/resume actions inline. Realtime invalidation fires the table query
 * key whenever `automationsService.pauseRule`/`resumeRule` emit pg_notify.
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
import { Pause, Play, Workflow } from 'lucide-react'
import { useMemo, useState } from 'react'

import { DataTable } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { Status } from '@/components/ui/status'
import {
  type AutomationRow,
  useActivityAutomations,
  usePauseAutomation,
  useResumeAutomation,
} from '../hooks/use-activity'

function lastStatusVariant(s: string | null): React.ComponentProps<typeof Status>['variant'] {
  if (s === 'succeeded') return 'success'
  if (s === 'failed') return 'failed'
  if (s?.startsWith('suppressed')) return 'warning'
  return 'neutral'
}

export function AutomationsTable() {
  const { data: rows = [], isLoading } = useActivityAutomations()
  const pause = usePauseAutomation()
  const resume = useResumeAutomation()

  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 })

  const columns = useMemo<ColumnDef<AutomationRow>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Name" />,
        cell: ({ row }) => <span className="font-medium text-foreground text-sm">{row.original.name}</span>,
        meta: { label: 'Name', variant: 'text', placeholder: 'Search name…' },
        enableColumnFilter: true,
        enableSorting: true,
      },
      {
        id: 'eventName',
        accessorKey: 'eventName',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Event" />,
        cell: ({ row }) => <span className="font-mono text-muted-foreground text-xs">{row.original.eventName}</span>,
        meta: { label: 'Event' },
        enableSorting: true,
      },
      {
        id: 'actionType',
        accessorKey: 'actionType',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Action" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {row.original.actionType}
            {row.original.lane ? ` · ${row.original.lane}` : ''}
          </span>
        ),
        meta: { label: 'Action' },
        enableSorting: false,
      },
      {
        id: 'status',
        accessorKey: 'paused',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Status" />,
        cell: ({ row }) =>
          row.original.paused ? (
            <Status variant="failed" label="paused" />
          ) : (
            <Status variant="success" label="active" />
          ),
        enableSorting: true,
      },
      {
        id: 'lastFire',
        accessorKey: 'lastFire',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Last fire" />,
        cell: ({ row }) =>
          row.original.lastFire ? (
            <RelativeTimeCard date={row.original.lastFire} />
          ) : (
            <span className="text-muted-foreground/60">—</span>
          ),
        enableSorting: true,
      },
      {
        id: 'lastStatus',
        accessorKey: 'lastStatus',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Last status" />,
        cell: ({ row }) =>
          row.original.lastStatus ? (
            <Status variant={lastStatusVariant(row.original.lastStatus)} label={row.original.lastStatus} />
          ) : (
            <span className="text-muted-foreground/60">—</span>
          ),
        enableSorting: false,
      },
      {
        id: 'fireCount24h',
        accessorKey: 'fireCount24h',
        header: ({ column }) => <DataTableColumnHeader column={column} label="24h fires" />,
        cell: ({ row }) => <span className="text-foreground tabular-nums">{row.original.fireCount24h}</span>,
        enableSorting: true,
      },
      {
        id: 'suppressionCount24h',
        accessorKey: 'suppressionCount24h',
        header: ({ column }) => <DataTableColumnHeader column={column} label="24h suppressions" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular-nums">{row.original.suppressionCount24h}</span>
        ),
        enableSorting: true,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end">
            {row.original.paused ? (
              <Button
                size="sm"
                variant="outline"
                disabled={resume.isPending}
                onClick={() => resume.mutate({ ruleId: row.original.id })}
              >
                <Play className="size-3.5" />
                Resume
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={pause.isPending}
                onClick={() => {
                  const reason = prompt('Reason for pausing this rule?', 'manual')
                  if (!reason) return
                  pause.mutate({ ruleId: row.original.id, reason })
                }}
              >
                <Pause className="size-3.5" />
                Pause
              </Button>
            )}
          </div>
        ),
        enableSorting: false,
      },
    ],
    [pause, resume],
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
            <Workflow className="size-5" />
          </EmptyMedia>
          <EmptyTitle>No automations seeded yet</EmptyTitle>
          <EmptyDescription>See modules/automations/seed.ts for the built-in cron rules.</EmptyDescription>
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
