import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useState } from 'react';

import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import {
  DataTableCellBadge,
  DataTableCellText,
  DataTableCellTimestamp,
} from '@/components/data-table/data-table-cell';
import { DataTableFilterControls } from '@/components/data-table/data-table-filter-controls';
import { DataTableProvider } from '@/components/data-table/data-table-provider';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import type { DataTableFilterField } from '@/components/data-table/types';
import { useControls } from '@/providers/controls';

interface Contact {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  channel: string | null;
  createdAt: string;
  updatedAt: string;
}

async function fetchContacts(): Promise<Contact[]> {
  const res = await fetch('/api/messaging/contacts');
  if (!res.ok) throw new Error('Failed to fetch contacts');
  return res.json();
}

const filterFields: DataTableFilterField<Contact>[] = [
  {
    type: 'input',
    value: 'name',
    label: 'Search',
    defaultOpen: true,
  },
  {
    type: 'checkbox',
    value: 'channel',
    label: 'Channel',
    defaultOpen: true,
    options: [
      { label: 'WhatsApp', value: 'whatsapp' },
      { label: 'Web', value: 'web' },
      { label: 'Email', value: 'email' },
    ],
  },
  {
    type: 'timerange',
    value: 'createdAt',
    label: 'Created',
    defaultOpen: false,
  },
];

const columns: ColumnDef<Contact>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
    cell: ({ row }) => (
      <DataTableCellText value={row.original.name ?? 'Unknown'} />
    ),
    enableSorting: true,
    enableHiding: true,
    meta: { label: 'Name' },
    filterFn: (row, _columnId, filterValue) => {
      if (!filterValue) return true;
      const search = (filterValue as string).toLowerCase();
      const name = (row.original.name ?? '').toLowerCase();
      const phone = (row.original.phone ?? '').toLowerCase();
      const email = (row.original.email ?? '').toLowerCase();
      return (
        name.includes(search) ||
        phone.includes(search) ||
        email.includes(search)
      );
    },
  },
  {
    accessorKey: 'phone',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Phone" />
    ),
    cell: ({ row }) => <DataTableCellText value={row.original.phone ?? '-'} />,
    enableSorting: true,
    enableHiding: true,
    meta: { label: 'Phone' },
  },
  {
    accessorKey: 'email',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Email" />
    ),
    cell: ({ row }) => <DataTableCellText value={row.original.email ?? '-'} />,
    enableSorting: true,
    enableHiding: true,
    meta: { label: 'Email' },
  },
  {
    accessorKey: 'channel',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Channel" />
    ),
    cell: ({ row }) =>
      row.original.channel ? (
        <DataTableCellBadge value={row.original.channel} />
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
    enableSorting: true,
    enableHiding: true,
    meta: { label: 'Channel' },
    filterFn: (row, _columnId, filterValue) => {
      if (
        !filterValue ||
        !Array.isArray(filterValue) ||
        filterValue.length === 0
      )
        return true;
      return filterValue.includes(row.original.channel);
    },
  },
  {
    accessorKey: 'createdAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Created" />
    ),
    cell: ({ row }) => <DataTableCellTimestamp date={row.original.createdAt} />,
    enableSorting: true,
    enableHiding: true,
    meta: { label: 'Created' },
    filterFn: (row, _columnId, filterValue) => {
      if (!filterValue || !Array.isArray(filterValue)) return true;
      const date = new Date(row.original.createdAt);
      const [from, to] = filterValue as Date[];
      if (from && !to) return date >= from;
      if (from && to) return date >= from && date <= to;
      return true;
    },
  },
];

function ContactsFilterPanel() {
  const { open } = useControls();
  if (!open) return null;
  return (
    <div className="hidden w-[240px] shrink-0 sm:block">
      <DataTableFilterControls />
    </div>
  );
}

function ContactsPage() {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['messaging-contacts'],
    queryFn: fetchContacts,
  });

  const table = useReactTable({
    data: contacts,
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

  return (
    <DataTableProvider
      table={table}
      columns={columns}
      filterFields={filterFields}
      columnFilters={columnFilters}
      sorting={sorting}
      isLoading={isLoading}
      totalRows={contacts.length}
    >
      <div className="flex flex-col gap-4 p-6 lg:p-10">
        <div>
          <h2 className="text-lg font-semibold">Contacts</h2>
          <p className="text-sm text-muted-foreground">
            External contacts from messaging channels
          </p>
        </div>
        <DataTableToolbar />
        <div className="flex gap-4">
          <ContactsFilterPanel />
          <div className="flex-1 overflow-hidden">
            <DataTable table={table} />
          </div>
        </div>
      </div>
    </DataTableProvider>
  );
}

export const Route = createFileRoute('/_app/messaging/contacts')({
  component: ContactsPage,
});
