import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';

import { DataTable } from '@/components/data-table/data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableViewOptions } from '@/components/data-table/data-table-view-options';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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

const columnHelper = createColumnHelper<AuditEntry>();

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }

  return date.toLocaleString();
}

export type SystemLogsPageProps = Record<string, never>;

export function SystemLogsPage(_: Readonly<SystemLogsPageProps>) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [sorting, setSorting] = useState<SortingState>([]);

  const auditQuery = useQuery({
    queryKey: ['system-audit-log', cursor],
    queryFn: () => fetchAuditLog(cursor),
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor('event', {
        header: ({ column }) => (
          <DataTableColumnHeader column={column} label="Event" />
        ),
        cell: (info) => <span className="font-medium">{info.getValue()}</span>,
        enableSorting: true,
        enableHiding: true,
        meta: { label: 'Event' },
      }),
      columnHelper.accessor('actorEmail', {
        header: ({ column }) => (
          <DataTableColumnHeader column={column} label="Actor" />
        ),
        cell: (info) => (
          <span className="text-muted-foreground">
            {info.getValue() ?? 'Unknown actor'}
          </span>
        ),
        enableSorting: true,
        enableHiding: true,
        meta: { label: 'Actor' },
      }),
      columnHelper.accessor('createdAt', {
        header: ({ column }) => (
          <DataTableColumnHeader column={column} label="Timestamp" />
        ),
        cell: (info) => (
          <span className="text-muted-foreground">
            {formatTimestamp(info.getValue())}
          </span>
        ),
        enableSorting: true,
        enableHiding: true,
        meta: { label: 'Timestamp' },
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: auditQuery.data?.entries ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const canGoBack = history.length > 0;
  const canGoNext = auditQuery.data?.nextCursor != null;

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-10">
      <PageHeader title="Audit Log" description="All system and user events" />

      <Card>
        <CardContent className="pt-6">
          {auditQuery.isPending ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : auditQuery.isError ? (
            <p className="text-sm text-destructive">
              Unable to load audit log entries.
            </p>
          ) : table.getRowModel().rows.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No audit entries"
              description="Events will appear here once activity occurs."
            />
          ) : (
            <DataTable table={table}>
              <div className="flex items-center justify-end p-1">
                <DataTableViewOptions table={table} align="end" />
              </div>
            </DataTable>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
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
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/_app/system/logs')({
  component: SystemLogsPage,
});
