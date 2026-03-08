import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/api-client';

interface AuditEntry {
  id?: string;
  event: string;
  actorEmail: string | null;
  createdAt: string | number | Date;
}

interface AuditLogResponse {
  entries: AuditEntry[];
  nextCursor?: number;
}

const columnHelper = createColumnHelper<AuditEntry>();

function formatTimestamp(value: AuditEntry['createdAt']): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }

  return date.toLocaleString();
}

async function fetchAuditLog(cursor: number | null): Promise<AuditLogResponse> {
  const response = await apiClient.api.system['audit-log'].$get({
    query: cursor === null ? {} : { cursor: String(cursor) },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch audit log page');
  }

  return (await response.json()) as AuditLogResponse;
}

export type SystemLogsPageProps = Record<string, never>;

export function SystemLogsPage(_: Readonly<SystemLogsPageProps>) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [history, setHistory] = useState<Array<number | null>>([]);

  const auditQuery = useQuery({
    queryKey: ['system-audit-log', cursor],
    queryFn: () => fetchAuditLog(cursor),
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor('event', {
        header: 'Event',
        cell: (info) => <span className="font-medium">{info.getValue()}</span>,
      }),
      columnHelper.accessor('actorEmail', {
        header: 'Actor',
        cell: (info) => info.getValue() ?? 'Unknown actor',
      }),
      columnHelper.accessor('createdAt', {
        header: 'Created at',
        cell: (info) => formatTimestamp(info.getValue()),
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: auditQuery.data?.entries ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const canGoBack = history.length > 0;
  const canGoNext = auditQuery.data?.nextCursor !== undefined;

  return (
    <div className="flex flex-col gap-8 p-6 lg:p-10">
      <div>
        <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
          System
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">Audit log</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity stream</CardTitle>
          <CardDescription>
            Cursor-based paginated events from /api/system/audit-log
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {auditQuery.isPending ? (
            <div className="flex flex-col gap-3">
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
            <p className="text-sm text-muted-foreground">
              No audit log entries found.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-160 text-left text-sm">
                <thead className="bg-muted/50">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th key={header.id} className="px-4 py-3 font-semibold">
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="border-t">
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className="px-4 py-3 text-muted-foreground"
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!canGoBack || auditQuery.isPending}
              onClick={() => {
                if (!canGoBack) {
                  return;
                }

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
                if (nextCursor === undefined) {
                  return;
                }

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
