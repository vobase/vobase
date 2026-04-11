import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { MailIcon, MoreHorizontal, PhoneIcon, UserPlus } from 'lucide-react';
import {
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  useQueryState,
  useQueryStates,
} from 'nuqs';

import { DataTable } from '@/components/data-table/data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import { useDataTable } from '@/hooks/use-data-table';
import { messagingClient } from '@/lib/api-client';
import { getSortingStateParser } from '@/lib/parsers';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  identifier: string | null;
  role: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Data fetching ──────────────────────────────────────────────────

interface ContactsParams {
  page: number;
  perPage: number;
  sort: string;
  name: string;
  role: string;
  createdAt: string;
}

async function fetchContacts(
  params: ContactsParams,
): Promise<{ data: Contact[]; pageCount: number }> {
  const query: Record<string, string> = {
    page: String(params.page),
    perPage: String(params.perPage),
  };
  if (params.sort) query.sort = params.sort;
  if (params.name) query.name = params.name;
  if (params.role) query.role = params.role;
  if (params.createdAt) query.createdAt = params.createdAt;

  const res = await messagingClient.contacts.table.$get({ query });
  if (!res.ok) throw new Error('Failed to fetch contacts');
  return res.json() as Promise<{ data: Contact[]; pageCount: number }>;
}

// ─── Role badge styles ──────────────────────────────────────────────

const roleColors: Record<string, string> = {
  staff: 'bg-blue-100/30 text-blue-900 dark:text-blue-200 border-blue-200',
  lead: 'bg-amber-100/30 text-amber-900 dark:text-amber-200 border-amber-200',
  customer: 'bg-neutral-300/40 border-neutral-300',
};

// ─── Column definitions ─────────────────────────────────────────────

const columns: ColumnDef<Contact>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Name" />
    ),
    cell: ({ row }) => {
      const contact = row.original;
      const label = contact.name ?? contact.identifier ?? contact.id;
      return (
        <Link
          to="/messaging/contacts/$contactId"
          params={{ contactId: contact.id }}
          className="font-medium hover:underline underline-offset-2"
        >
          {label}
        </Link>
      );
    },
    meta: {
      label: 'Search',
      variant: 'text',
      placeholder: 'Search contacts...',
    },
    enableColumnFilter: true,
    enableSorting: true,
    enableHiding: false,
  },
  {
    id: 'email',
    accessorKey: 'email',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Email" />
    ),
    cell: ({ row }) => {
      const email = row.getValue('email') as string | null;
      if (!email)
        return <span className="text-muted-foreground/40">&mdash;</span>;
      return (
        <span className="flex items-center gap-1.5 text-nowrap">
          <MailIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {email}
        </span>
      );
    },
    meta: { label: 'Email' },
    enableSorting: true,
  },
  {
    id: 'phone',
    accessorKey: 'phone',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Phone" />
    ),
    cell: ({ row }) => {
      const phone = row.getValue('phone') as string | null;
      if (!phone)
        return <span className="text-muted-foreground/40">&mdash;</span>;
      return (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <PhoneIcon className="h-3.5 w-3.5 shrink-0" />
          {phone}
        </span>
      );
    },
    meta: { label: 'Phone' },
    enableSorting: false,
  },
  {
    id: 'role',
    accessorKey: 'role',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Role" />
    ),
    cell: ({ row }) => {
      const role = row.getValue('role') as string;
      return (
        <Badge variant="outline" className={cn('capitalize', roleColors[role])}>
          {role}
        </Badge>
      );
    },
    filterFn: (row, id, value) => {
      return Array.isArray(value)
        ? value.includes(row.getValue(id))
        : row.getValue(id) === value;
    },
    meta: {
      label: 'Role',
      variant: 'multiSelect',
      options: [
        { label: 'Customer', value: 'customer' },
        { label: 'Lead', value: 'lead' },
        { label: 'Staff', value: 'staff' },
      ],
    },
    enableColumnFilter: true,
    enableSorting: true,
    enableHiding: false,
  },
  {
    id: 'createdAt',
    accessorKey: 'createdAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Created" />
    ),
    cell: ({ row }) => {
      const date = row.getValue('createdAt') as string;
      return <RelativeTimeCard date={date} />;
    },
    meta: { label: 'Created', variant: 'dateRange' },
    enableColumnFilter: true,
    enableSorting: true,
  },
  {
    id: 'updatedAt',
    accessorKey: 'updatedAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} label="Updated" />
    ),
    cell: ({ row }) => {
      const date = row.getValue('updatedAt') as string;
      return <RelativeTimeCard date={date} />;
    },
    meta: { label: 'Updated' },
    enableSorting: true,
  },
  {
    id: 'actions',
    cell: ({ row }) => {
      const contact = row.original;
      return (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex h-8 w-8 p-0 data-[state=open]:bg-muted"
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[160px]">
            <DropdownMenuItem asChild>
              <Link
                to="/messaging/contacts/$contactId"
                params={{ contactId: contact.id }}
              >
                View details
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];

// ─── URL state for query keys ───────────────────────────────────────

const ARRAY_SEPARATOR = ',';

function useContactsSearchParams() {
  const [page] = useQueryState('page', parseAsInteger.withDefault(1));
  const [perPage] = useQueryState('perPage', parseAsInteger.withDefault(10));
  const [sort] = useQueryState(
    'sort',
    getSortingStateParser<Contact>().withDefault([
      { id: 'createdAt', desc: true },
    ]),
  );
  const [filterValues] = useQueryStates({
    name: parseAsString.withDefault(''),
    role: parseAsArrayOf(parseAsString, ARRAY_SEPARATOR).withDefault([]),
    createdAt: parseAsArrayOf(parseAsString, ARRAY_SEPARATOR).withDefault([]),
  });

  return {
    page,
    perPage,
    sort: JSON.stringify(sort),
    name: filterValues.name,
    role: filterValues.role.join(ARRAY_SEPARATOR),
    createdAt: filterValues.createdAt.join(ARRAY_SEPARATOR),
  };
}

// ─── Page ───────────────────────────────────────────────────────────

function ContactsPage() {
  const searchParams = useContactsSearchParams();

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', searchParams],
    queryFn: () => fetchContacts(searchParams),
    placeholderData: (prev) => prev,
  });

  const { table } = useDataTable({
    data: data?.data ?? [],
    pageCount: data?.pageCount ?? -1,
    columns,
    initialState: {
      sorting: [{ id: 'createdAt', desc: true }],
      columnVisibility: { updatedAt: false },
    },
  });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Contacts</h2>
          <p className="text-muted-foreground">
            Manage your contacts and their roles here.
          </p>
        </div>
        <Button size="sm">
          <UserPlus className="mr-2 h-4 w-4" />
          Add Contact
        </Button>
      </div>

      {isLoading && !data ? (
        <DataTableSkeleton
          columnCount={columns.length}
          filterCount={2}
          cellWidths={[
            '10rem',
            '14rem',
            '10rem',
            '6rem',
            '8rem',
            '8rem',
            '3rem',
          ]}
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

export const Route = createFileRoute('/_app/messaging/contacts/')({
  component: ContactsPage,
});
