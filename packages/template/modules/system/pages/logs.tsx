import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';

import { DataTable } from '@/components/data-table/data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableFilterControls } from '@/components/data-table/data-table-filter-controls';
import { DataTableProvider } from '@/components/data-table/data-table-provider';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import type { DataTableFilterField } from '@/components/data-table/types';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { systemClient } from '@/lib/api-client';
import { useControls } from '@/providers/controls';

async function fetchAuditLog(cursor: string | null) {
  const response = await systemClient['audit-log'].$get({
    query: cursor === null ? {} : { cursor },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch audit log page');
  }

  return response.json();
}

type AuditEntry = Awaited<ReturnType<typeof fetchAuditLog>>['entries'][number];

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }
  return date.toLocaleString();
}

const filterFields: DataTableFilterField<AuditEntry>[] = [
  {
    type: 'input',
    value: 'event',
    label: 'Search',
    defaultOpen: true,
  },
];

function LogsFilterPanel() {
  const { open } = useControls();
  if (!open) return null;
  return (
    <div className="hidden w-[240px] shrink-0 sm:block">
      <DataTableFilterControls />
    </div>
  );
}

export type SystemLogsPageProps = Record<string, never>;

export function SystemLogsPage(_: Readonly<SystemLogsPageProps>) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const auditQuery = useQuery({
    queryKey: ['system-audit-log', cursor],
    queryFn: () => fetchAuditLog(cursor),
  });

  const columns = useMemo<ColumnDef<AuditEntry>[]>(
    () => [
      {
        accessorKey: 'event',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Event" />
        ),
        cell: (info) => (
          <span className="font-medium">{info.getValue() as string}</span>
        ),
        enableSorting: true,
        enableHiding: true,
        meta: { label: 'Event' },
      },
      {
        accessorKey: 'actorEmail',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Actor" />
        ),
        cell: (info) => (
          <span className="text-muted-foreground">
            {(info.getValue() as string | null) ?? 'Unknown actor'}
          </span>
        ),
        enableSorting: true,
        enableHiding: true,
        meta: { label: 'Actor' },
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Timestamp" />
        ),
        cell: (info) => (
          <span className="text-muted-foreground">
            {formatTimestamp(info.getValue() as string)}
          </span>
        ),
        enableSorting: true,
        enableHiding: true,
        meta: { label: 'Timestamp' },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: auditQuery.data?.entries ?? [],
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  const canGoBack = history.length > 0;
  const canGoNext = auditQuery.data?.nextCursor != null;

  return (
    <DataTableProvider
      table={table}
      columns={columns}
      filterFields={filterFields}
      columnFilters={columnFilters}
      sorting={sorting}
      isLoading={auditQuery.isPending}
    >
      <div className="flex flex-col gap-6 p-6 lg:p-10">
        <PageHeader
          title="Audit Log"
          description="All system and user events"
        />

        {auditQuery.isError ? (
          <p className="text-sm text-destructive">
            Unable to load audit log entries.
          </p>
        ) : table.getRowModel().rows.length === 0 && !auditQuery.isPending ? (
          <EmptyState
            icon={ScrollText}
            title="No audit entries"
            description="Events will appear here once activity occurs."
          />
        ) : (
          <>
            <DataTableToolbar />
            <div className="flex gap-4">
              <LogsFilterPanel />
              <div className="flex-1 overflow-hidden">
                <DataTable table={table} />
              </div>
            </div>
          </>
        )}

        {/* Server-side cursor pagination for fetching pages from the API.
            Client-side filtering (above) applies only to the current fetched page. */}
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canGoBack || auditQuery.isPending}
            onClick={() => {
              if (!canGoBack) return;
              setHistory((currentHistory) => {
                const previous =
                  currentHistory[currentHistory.length - 1] ?? null;
                setCursor(previous);
                return currentHistory.slice(0, -1);
              });
            }}
          >
            Previous
          </Button>
          <Button
            size="sm"
            disabled={!canGoNext || auditQuery.isPending}
            onClick={() => {
              const nextCursor = auditQuery.data?.nextCursor;
              if (nextCursor === undefined) return;
              setHistory((currentHistory) => [...currentHistory, cursor]);
              setCursor(nextCursor);
            }}
          >
            Next
          </Button>
        </div>
      </div>
    </DataTableProvider>
  );
}

export const Route = createFileRoute('/_app/system/logs')({
  component: SystemLogsPage,
});
