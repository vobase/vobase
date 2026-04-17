import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import {
  MailIcon,
  MoreHorizontal,
  PencilIcon,
  PhoneIcon,
  SettingsIcon,
  TrashIcon,
  UserPlus,
} from 'lucide-react';
import {
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DataTable } from '@/components/data-table/data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import { useDataTable } from '@/hooks/use-data-table';
import { messagingClient } from '@/lib/api-client';
import { getSortingStateParser } from '@/lib/parsers';
import { cn } from '@/lib/utils';
import { ContactFormDialog } from './_components/contact-form-dialog';

// ─── Types ──────────────────────────────────────────────────────────

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  identifier: string | null;
  role: string;
  attributes: Record<string, unknown> | null;
  marketingOptOut: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AttributeDefinition {
  id: string;
  key: string;
  label: string;
  type: string;
  showInTable: boolean;
  sortOrder: number;
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

async function fetchAttributeDefinitions(): Promise<AttributeDefinition[]> {
  const res = await messagingClient['attribute-definitions'].$get();
  if (!res.ok) return [];
  const json = (await res.json()) as { data: AttributeDefinition[] };
  return json.data;
}

import { roleColors } from './_lib/helpers';

// ─── Dynamic attribute columns ──────────────────────────────────────

function createAttributeColumn(def: AttributeDefinition): ColumnDef<Contact> {
  return {
    id: `attr_${def.key}`,
    header: def.label,
    cell: ({ row }) => {
      const attrs = row.original.attributes;
      const value = attrs?.[def.key];
      if (value === undefined || value === null || value === '') {
        return <span className="text-muted-foreground/40">&mdash;</span>;
      }
      if (def.type === 'boolean') {
        return <span className="text-sm">{value === true ? 'Yes' : 'No'}</span>;
      }
      return (
        <span className="text-sm text-muted-foreground">{String(value)}</span>
      );
    },
    enableSorting: false,
    enableHiding: true,
  };
}

// ─── URL state for query keys ───────────────────────────────────────

const ARRAY_SEPARATOR = ',';

function useContactsSearchParams() {
  const [page] = useQueryState('page', parseAsInteger.withDefault(1));
  const [perPage] = useQueryState('perPage', parseAsInteger.withDefault(20));
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
  const queryClient = useQueryClient();
  const searchParams = useContactsSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', searchParams],
    queryFn: () => fetchContacts(searchParams),
    placeholderData: (prev) => prev,
  });

  const { data: attrDefs } = useQuery({
    queryKey: ['attribute-definitions'],
    queryFn: fetchAttributeDefinitions,
    staleTime: 300_000,
  });

  const createMutation = useMutation({
    mutationFn: async (data: {
      name?: string;
      phone?: string;
      email?: string;
      identifier?: string;
      role: string;
    }) => {
      const res = await messagingClient.contacts.$post(
        {},
        {
          init: {
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err?.error?.message ?? 'Failed to create contact');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setDialogOpen(false);
      toast.success('Contact created');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: {
        name?: string;
        phone?: string;
        email?: string;
        identifier?: string;
        role: string;
      };
    }) => {
      const res = await messagingClient.contacts[':id'].$patch(
        { param: { id } },
        {
          init: {
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err?.error?.message ?? 'Failed to update contact');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setDialogOpen(false);
      setEditingContact(null);
      toast.success('Contact updated');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await messagingClient.contacts[':id'].$delete({
        param: { id },
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err?.error?.message ?? 'Failed to delete contact');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setDeleteTarget(null);
      toast.success('Contact deleted');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  function handleSave(data: {
    name?: string;
    phone?: string;
    email?: string;
    identifier?: string;
    role: string;
  }) {
    if (editingContact) {
      updateMutation.mutate({ id: editingContact.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  function openCreate() {
    setEditingContact(null);
    setDialogOpen(true);
  }

  const openEdit = useCallback((contact: Contact) => {
    setEditingContact(contact);
    setDialogOpen(true);
  }, []);

  // Build columns: static + dynamic attribute columns + tail (with actions)
  const columns = useMemo(() => {
    const dynamicCols = (attrDefs ?? [])
      .filter((d) => d.showInTable)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(createAttributeColumn);

    const staticCols: ColumnDef<Contact>[] = [
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
          variant: 'text' as const,
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
            <Badge
              variant="outline"
              className={cn('capitalize', roleColors[role])}
            >
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
          variant: 'multiSelect' as const,
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
    ];

    const tailCols: ColumnDef<Contact>[] = [
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
        meta: { label: 'Created', variant: 'dateRange' as const },
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
                <DropdownMenuItem onClick={() => openEdit(contact)}>
                  <PencilIcon className="mr-2 h-3.5 w-3.5" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteTarget(contact)}
                >
                  <TrashIcon className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
        enableSorting: false,
        enableHiding: false,
      },
    ];

    return [...staticCols, ...dynamicCols, ...tailCols];
  }, [attrDefs, openEdit]);

  const { table } = useDataTable({
    data: data?.data ?? [],
    pageCount: data?.pageCount ?? -1,
    columns,
    initialState: {
      sorting: [{ id: 'createdAt', desc: true }],
      columnVisibility: { updatedAt: false },
      pagination: { pageIndex: 0, pageSize: 20 },
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/messaging/contacts/attributes">
              <SettingsIcon className="mr-2 h-4 w-4" />
              Attributes
            </Link>
          </Button>
          <Button size="sm" onClick={openCreate}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add Contact
          </Button>
        </div>
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
            ...(attrDefs ?? []).filter((d) => d.showInTable).map(() => '8rem'),
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

      <ContactFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingContact(null);
        }}
        contact={editingContact}
        onSave={handleSave}
        isPending={createMutation.isPending || updateMutation.isPending}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{' '}
              <span className="font-medium text-foreground">
                {deleteTarget?.name ?? deleteTarget?.phone ?? deleteTarget?.id}
              </span>{' '}
              and remove all their labels. Contacts with active conversations
              cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/contacts/')({
  component: ContactsPage,
});
