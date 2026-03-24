import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
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
import { formatDistanceToNowStrict } from 'date-fns';
import { ArrowLeft, Inbox, MessageSquare } from 'lucide-react';
import { useState } from 'react';

import { DataTable } from '@/components/data-table/data-table';
import {
  DataTableCellBadge,
  DataTableCellText,
  DataTableCellTimestamp,
} from '@/components/data-table/data-table-cell';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableFilterControls } from '@/components/data-table/data-table-filter-controls';
import { DataTableProvider } from '@/components/data-table/data-table-provider';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import type { DataTableFilterField } from '@/components/data-table/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useControls } from '@/providers/controls';

interface Contact {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  channel: string | null;
  identifier: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ContactDetail extends Contact {
  conversations: Array<{
    id: string;
    title: string | null;
    channel: string;
    status: string;
    handler: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

interface ContactInbox {
  id: string;
  contactId: string;
  inboxId: string;
  sourceId: string;
  createdAt: string;
  inboxName: string | null;
  inboxChannel: string | null;
}

async function fetchContacts(): Promise<Contact[]> {
  const res = await fetch('/api/messaging/contacts');
  if (!res.ok) throw new Error('Failed to fetch contacts');
  return res.json();
}

async function fetchContactDetail(id: string): Promise<ContactDetail> {
  const res = await fetch(`/api/messaging/contacts/${id}`);
  if (!res.ok) throw new Error('Failed to fetch contact');
  return res.json();
}

async function fetchContactInboxes(id: string): Promise<ContactInbox[]> {
  const res = await fetch(`/api/messaging/contacts/${id}/inboxes`);
  if (!res.ok) return [];
  return res.json();
}

function relativeTime(dateStr: string): string {
  try {
    return formatDistanceToNowStrict(new Date(dateStr), { addSuffix: true });
  } catch {
    return '';
  }
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-emerald-500',
  pending: 'bg-amber-500',
  resolved: 'bg-gray-400',
  snoozed: 'bg-blue-500',
  closed: 'bg-gray-400',
};

// ─── Contact Detail Panel ────────────────────────────────────────────

function ContactDetailPanel({
  contactId,
  onClose,
}: {
  contactId: string;
  onClose: () => void;
}) {
  const { data: contact } = useQuery({
    queryKey: ['messaging-contact', contactId],
    queryFn: () => fetchContactDetail(contactId),
  });

  const { data: contactInboxes = [] } = useQuery({
    queryKey: ['messaging-contact-inboxes', contactId],
    queryFn: () => fetchContactInboxes(contactId),
  });

  if (!contact) {
    return (
      <div className="w-[350px] border-l p-4">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="w-[350px] border-l flex flex-col overflow-y-auto">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onClose}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h3 className="text-sm font-semibold">
          {contact.name ?? 'Unknown Contact'}
        </h3>
      </div>

      <div className="p-4 space-y-6">
        {/* Basic info */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Contact Info
          </h4>
          <div className="space-y-1 text-sm">
            {contact.phone && (
              <p>
                <span className="text-muted-foreground">Phone:</span>{' '}
                {contact.phone}
              </p>
            )}
            {contact.email && (
              <p>
                <span className="text-muted-foreground">Email:</span>{' '}
                {contact.email}
              </p>
            )}
            {contact.channel && (
              <p>
                <span className="text-muted-foreground">Channel:</span>{' '}
                {contact.channel}
              </p>
            )}
            {contact.identifier && (
              <p>
                <span className="text-muted-foreground">Identifier:</span>{' '}
                <span className="font-mono text-xs">{contact.identifier}</span>
              </p>
            )}
          </div>
        </div>

        <Separator />

        {/* Channel identities (contact inboxes) */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Inbox className="size-3.5" />
            Channel Identities
          </h4>
          {contactInboxes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No channel identities found.
            </p>
          ) : (
            <div className="space-y-2">
              {contactInboxes.map((ci) => (
                <div
                  key={ci.id}
                  className="flex items-center gap-2 text-sm border rounded-md px-3 py-2"
                >
                  <Badge variant="secondary" className="text-xs">
                    {ci.inboxChannel ?? 'unknown'}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">
                      {ci.inboxName ?? ci.inboxId}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {ci.sourceId}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Conversation history */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <MessageSquare className="size-3.5" />
            Conversations ({contact.conversations.length})
          </h4>
          {contact.conversations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No conversations yet.
            </p>
          ) : (
            <div className="space-y-1">
              {contact.conversations.map((conv) => (
                <Link
                  key={conv.id}
                  to="/messaging/conversations/$conversationId"
                  params={{ conversationId: conv.id }}
                  className="block rounded-md border px-3 py-2 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-1.5 rounded-full shrink-0 ${STATUS_COLORS[conv.status] ?? 'bg-gray-400'}`}
                    />
                    <span className="text-xs font-medium truncate">
                      {conv.title ?? `${conv.channel} conversation`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {conv.channel}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {conv.handler === 'ai' ? 'AI' : 'Human'}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {relativeTime(conv.updatedAt)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null,
  );

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
    <div className="flex h-full">
      <DataTableProvider
        table={table}
        columns={columns}
        filterFields={filterFields}
        columnFilters={columnFilters}
        sorting={sorting}
        isLoading={isLoading}
        totalRows={contacts.length}
      >
        <div className="flex flex-col gap-4 p-6 lg:p-10 flex-1 min-w-0">
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
              <DataTable
                table={table}
                onRowClick={(row) => setSelectedContactId(row.original.id)}
              />
            </div>
          </div>
        </div>
      </DataTableProvider>

      {selectedContactId && (
        <ContactDetailPanel
          contactId={selectedContactId}
          onClose={() => setSelectedContactId(null)}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/contacts')({
  component: ContactsPage,
});
