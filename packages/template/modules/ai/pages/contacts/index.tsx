import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { MailIcon, PhoneIcon } from 'lucide-react';
import { useMemo } from 'react';

import { DataTableInfinite } from '@/components/data-table/data-table-infinite';
import {
  createDataTableQueryOptions,
  getFacetedMinMaxValues,
  getFacetedUniqueValues,
} from '@/lib/data-table';
import { useMemoryAdapter } from '@/lib/store/adapters/memory';
import { useFilterState } from '@/lib/store/hooks/useFilterState';
import { DataTableStoreProvider } from '@/lib/store/provider/DataTableStoreProvider';
import { field } from '@/lib/store/schema/field';
import {
  generateColumns,
  generateFilterFields,
  generateFilterSchema,
  getDefaultColumnVisibility,
} from '@/lib/table-schema';
import { contactsTableSchema } from '../../lib/table-schemas';

// ─── Types ────────────────────────────────────────────────────────────

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  identifier: string | null;
  createdAt: string;
}

// ─── Schema-driven generation ────────────────────────────────────────

const filterFields = generateFilterFields<Contact>(contactsTableSchema);
const filterSchema = generateFilterSchema(contactsTableSchema, {
  sort: field.sort(),
});
const defaultColumnVisibility = getDefaultColumnVisibility(contactsTableSchema);

// ─── Search params serializer ────────────────────────────────────────

const searchParamsSerializer = (search: Record<string, unknown>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      if (value[0] instanceof Date) {
        params.set(key, value.map((d: Date) => d.getTime()).join(','));
      } else {
        params.set(key, value.join(','));
      }
    } else if (typeof value === 'object' && value !== null && 'id' in value) {
      const sort = value as { id: string; desc: boolean };
      params.set(key, `${sort.id}.${sort.desc ? 'desc' : 'asc'}`);
    } else if (value instanceof Date) {
      params.set(key, String(value.getTime()));
    } else {
      params.set(key, String(value));
    }
  }
  return `?${params.toString()}`;
};

// ─── Query options factory ───────────────────────────────────────────

const contactsQueryOptions = createDataTableQueryOptions<Contact[], unknown>({
  queryKeyPrefix: 'contacts',
  apiEndpoint: '/api/conversations/contacts-table/data',
  searchParamsSerializer,
});

// ─── Custom columns (Name, Phone, Email override generated defaults) ─

function buildColumns(): ColumnDef<Contact>[] {
  const generated = generateColumns<Contact>(contactsTableSchema);

  return generated.map((col) => {
    const key =
      'accessorKey' in col ? (col.accessorKey as string) : (col.id ?? '');

    if (key === 'name') {
      return {
        ...col,
        cell: ({ row }: { row: { original: Contact } }) => {
          const contact = row.original;
          const label = contact.name ?? contact.identifier ?? contact.id;
          return (
            <Link
              to="/contacts/$contactId"
              params={{ contactId: contact.id }}
              className="font-medium hover:underline underline-offset-2"
            >
              {label}
            </Link>
          );
        },
      };
    }

    if (key === 'phone') {
      return {
        ...col,
        cell: ({ row }: { row: { getValue: (k: string) => unknown } }) => {
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
      };
    }

    if (key === 'email') {
      return {
        ...col,
        cell: ({ row }: { row: { getValue: (k: string) => unknown } }) => {
          const email = row.getValue('email') as string | null;
          if (!email)
            return <span className="text-muted-foreground/40">&mdash;</span>;
          return (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <MailIcon className="h-3.5 w-3.5 shrink-0" />
              {email}
            </span>
          );
        },
      };
    }

    return col;
  });
}

const columns = buildColumns();

// ─── Inner component (needs store context for useFilterState) ────────

function ContactsTableInner() {
  const search = useFilterState();

  const queryOptions = useMemo(
    () => contactsQueryOptions(search as Record<string, unknown>),
    [search],
  );

  const { data, fetchNextPage, hasNextPage, isFetching, isLoading, refetch } =
    useInfiniteQuery(queryOptions);

  const flatData = useMemo(
    () => data?.pages.flatMap((p) => p.data) ?? [],
    [data],
  );
  const lastPage = data?.pages[data.pages.length - 1];
  const facets = lastPage?.meta.facets;

  return (
    <DataTableInfinite
      columns={columns}
      data={flatData}
      filterFields={filterFields}
      defaultColumnVisibility={defaultColumnVisibility}
      fetchNextPage={fetchNextPage}
      hasNextPage={hasNextPage}
      refetch={refetch}
      isFetching={isFetching}
      isLoading={isLoading}
      totalRows={lastPage?.meta.totalRowCount}
      filterRows={lastPage?.meta.filterRowCount}
      totalRowsFetched={flatData.length}
      getFacetedUniqueValues={getFacetedUniqueValues(facets)}
      getFacetedMinMaxValues={getFacetedMinMaxValues(facets)}
      tableId="contacts"
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

function ContactsPage() {
  const adapter = useMemoryAdapter(filterSchema.definition);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">Contacts</h2>
        <p className="text-sm text-muted-foreground">
          Manage your contact directory
        </p>
      </div>
      <DataTableStoreProvider adapter={adapter}>
        <ContactsTableInner />
      </DataTableStoreProvider>
    </div>
  );
}

export const Route = createFileRoute('/_app/contacts')({
  component: ContactsPage,
});
