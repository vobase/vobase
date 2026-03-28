import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import {
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
import { useState } from 'react';

import { DataTable } from '@/components/data-table/data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { systemClient } from '@/lib/api-client';

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

const columns: ColumnDef<AuditEntry>[] = [
  {
    id: 'event',
    accessorKey: 'event',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Event" />
    ),
    cell: (info) => (
      <span className="font-medium">{info.getValue() as string}</span>
    ),
    enableSorting: true,
    enableHiding: true,
    meta: {
      label: 'Event',
      variant: 'text',
      placeholder: 'Filter events...',
    },
    enableColumnFilter: true,
  },
  {
    id: 'actorEmail',
    accessorKey: 'actorEmail',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Actor" />
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
    id: 'createdAt',
    accessorKey: 'createdAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Timestamp" />
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
];

function SystemLogsPage() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const auditQuery = useQuery({
    queryKey: ['system-audit-log', cursor],
    queryFn: () => fetchAuditLog(cursor),
  });

  const table = useReactTable({
    data: auditQuery.data?.entries ?? [],
    columns,
    state: { sorting, columnFilters },
    defaultColumn: { enableColumnFilter: false },
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
    <div className="flex flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Audit Log</h2>
        <p className="text-muted-foreground">All system and user events.</p>
      </div>

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
        <DataTable table={table}>
          <DataTableToolbar table={table} />
        </DataTable>
      )}

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
  );
}

export const Route = createFileRoute('/_app/system/logs')({
  component: SystemLogsPage,
});
