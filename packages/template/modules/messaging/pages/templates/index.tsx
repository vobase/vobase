import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';

import { DataTable } from '@/components/data-table/data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import { Status, StatusIndicator, StatusLabel } from '@/components/ui/status';
import { useDataTable } from '@/hooks/use-data-table';
import { messagingClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────────────────

interface Template {
  id: string;
  channel: string;
  externalId: string | null;
  name: string;
  language: string;
  category: string | null;
  status: string | null;
  components: string | null;
  syncedAt: string;
  createdAt: string;
}

// ─── Data fetching ───────────────────────────────────────────────────

async function fetchTemplates(): Promise<Template[]> {
  const res = await messagingClient.templates.$get();
  if (!res.ok) throw new Error('Failed to fetch templates');
  const json = await res.json();
  return json.templates as Template[];
}

// ─── Status badge ────────────────────────────────────────────────────

type StatusVariant = 'success' | 'warning' | 'error' | 'default';

function templateStatusVariant(status: string | null): StatusVariant {
  if (status === 'APPROVED') return 'success';
  if (status === 'PENDING' || status === 'PENDING_DELETION') return 'warning';
  if (status === 'REJECTED' || status === 'DISABLED' || status === 'PAUSED')
    return 'error';
  return 'default';
}

// ─── Columns ─────────────────────────────────────────────────────────

const columns: ColumnDef<Template>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Name" />
    ),
    cell: ({ row }) => (
      <span className="font-medium font-mono text-sm">{row.original.name}</span>
    ),
    meta: {
      label: 'Search',
      variant: 'text',
      placeholder: 'Search templates...',
    },
    enableColumnFilter: true,
    enableSorting: true,
    enableHiding: false,
  },
  {
    id: 'category',
    accessorKey: 'category',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Category" />
    ),
    cell: ({ row }) => {
      const val = row.getValue('category') as string | null;
      if (!val)
        return <span className="text-muted-foreground/40">&mdash;</span>;
      return (
        <span className="capitalize text-sm text-muted-foreground">
          {val.toLowerCase().replace(/_/g, ' ')}
        </span>
      );
    },
    filterFn: (row, id, value) =>
      Array.isArray(value)
        ? value.includes(row.getValue(id))
        : row.getValue(id) === value,
    meta: {
      label: 'Category',
      variant: 'multiSelect',
      options: [
        { label: 'Marketing', value: 'MARKETING' },
        { label: 'Utility', value: 'UTILITY' },
        { label: 'Authentication', value: 'AUTHENTICATION' },
      ],
    },
    enableColumnFilter: true,
    enableSorting: true,
  },
  {
    id: 'language',
    accessorKey: 'language',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Language" />
    ),
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground uppercase">
        {row.getValue('language') as string}
      </span>
    ),
    meta: { label: 'Language' },
    enableSorting: true,
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Status" />
    ),
    cell: ({ row }) => {
      const s = row.getValue('status') as string | null;
      const variant = templateStatusVariant(s);
      const label = s
        ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')
        : 'Unknown';
      return (
        <Status variant={variant}>
          <StatusIndicator />
          <StatusLabel>{label}</StatusLabel>
        </Status>
      );
    },
    filterFn: (row, id, value) =>
      Array.isArray(value)
        ? value.includes(row.getValue(id))
        : row.getValue(id) === value,
    meta: {
      label: 'Status',
      variant: 'multiSelect',
      options: [
        { label: 'Approved', value: 'APPROVED' },
        { label: 'Pending', value: 'PENDING' },
        { label: 'Rejected', value: 'REJECTED' },
        { label: 'Disabled', value: 'DISABLED' },
        { label: 'Paused', value: 'PAUSED' },
      ],
    },
    enableColumnFilter: true,
    enableSorting: true,
  },
  {
    id: 'channel',
    accessorKey: 'channel',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Channel" />
    ),
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground capitalize">
        {row.getValue('channel') as string}
      </span>
    ),
    meta: { label: 'Channel' },
    enableSorting: true,
  },
  {
    id: 'syncedAt',
    accessorKey: 'syncedAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Last Synced" />
    ),
    cell: ({ row }) => (
      <RelativeTimeCard date={row.getValue('syncedAt') as string} />
    ),
    meta: { label: 'Last Synced' },
    enableSorting: true,
  },
];

// ─── Page ─────────────────────────────────────────────────────────────

function TemplatesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['messaging-templates'],
    queryFn: fetchTemplates,
    staleTime: 60_000,
  });

  const { table } = useDataTable({
    data: data ?? [],
    pageCount: -1,
    columns,
    initialState: {
      sorting: [{ id: 'syncedAt', desc: true }],
    },
  });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Templates</h2>
        <p className="text-muted-foreground">
          WhatsApp message templates synced from your connected accounts.
        </p>
      </div>

      {isLoading && !data ? (
        <DataTableSkeleton
          columnCount={columns.length}
          filterCount={2}
          cellWidths={['12rem', '8rem', '6rem', '8rem', '8rem', '8rem']}
          shrinkZero
        />
      ) : (
        <DataTable table={table}>
          <DataTableToolbar table={table}>
            <DataTableSortList table={table} />
          </DataTableToolbar>
        </DataTable>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/templates/')({
  component: TemplatesPage,
});
