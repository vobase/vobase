# Server-Side Data Table Pattern

Complete backend-to-frontend pattern for server-side filtered, sorted, paginated data tables using Hono + Drizzle + DiceUI `useDataTable`.

## Overview

The server-side pattern has three layers:

1. **`filterColumns()` helper** — Reusable filter-to-SQL translation (shared across all tables)
2. **Hono handler** — Table-specific endpoint with Zod validation
3. **Frontend page** — `useDataTable` + TanStack Query + URL params

## Layer 1: filterColumns() Helper

Location: `src/lib/filter-columns.ts`

Converts DiceUI filter state (from URL params) into Drizzle ORM WHERE conditions. Supports all DiceUI filter operators.

```typescript
import { addDays, endOfDay, startOfDay } from 'date-fns';
import {
  type AnyColumn, and, eq, gt, gte, ilike, inArray, isNull,
  lt, lte, ne, not, notIlike, notInArray, or, type SQL, type Table,
} from 'drizzle-orm';
import type { ExtendedColumnFilter, JoinOperator } from '@/types/data-table';

export function filterColumns<T extends Table>({
  table,
  filters,
  joinOperator,
}: {
  table: T;
  filters: ExtendedColumnFilter<T>[];
  joinOperator: JoinOperator;
}): SQL | undefined {
  const joinFn = joinOperator === 'and' ? and : or;

  const conditions = filters.map((filter) => {
    const column = table[filter.id] as AnyColumn;

    switch (filter.operator) {
      case 'iLike':
        return typeof filter.value === 'string'
          ? ilike(column, `%${filter.value}%`) : undefined;
      case 'notILike':
        return typeof filter.value === 'string'
          ? notIlike(column, `%${filter.value}%`) : undefined;
      case 'eq':
        if (filter.variant === 'date' || filter.variant === 'dateRange') {
          const date = new Date(Number(filter.value));
          return and(gte(column, startOfDay(date)), lte(column, endOfDay(date)));
        }
        return eq(column, filter.value);
      case 'ne':
        return ne(column, filter.value);
      case 'inArray':
        return Array.isArray(filter.value) ? inArray(column, filter.value) : undefined;
      case 'notInArray':
        return Array.isArray(filter.value) ? notInArray(column, filter.value) : undefined;
      case 'lt': return lt(column, filter.value);
      case 'lte': return lte(column, filter.value);
      case 'gt': return gt(column, filter.value);
      case 'gte': return gte(column, filter.value);
      case 'isBetween':
        if (Array.isArray(filter.value) && filter.value.length === 2) {
          if (filter.variant === 'date' || filter.variant === 'dateRange') {
            return and(
              filter.value[0] ? gte(column, startOfDay(new Date(Number(filter.value[0])))) : undefined,
              filter.value[1] ? lte(column, endOfDay(new Date(Number(filter.value[1])))) : undefined,
            );
          }
          const lo = filter.value[0]?.trim() !== '' ? Number(filter.value[0]) : null;
          const hi = filter.value[1]?.trim() !== '' ? Number(filter.value[1]) : null;
          return and(lo !== null ? gte(column, lo) : undefined, hi !== null ? lte(column, hi) : undefined);
        }
        return undefined;
      case 'isEmpty':
        return or(isNull(column), eq(column, '')) as SQL;
      case 'isNotEmpty':
        return not(or(isNull(column), eq(column, '')) as SQL);
      default:
        return undefined;
    }
  });

  const valid = conditions.filter(Boolean);
  return valid.length > 0 ? joinFn(...valid) : undefined;
}
```

### Supported operators

| Operator | Description | Value Type |
|----------|-------------|------------|
| `iLike` | Case-insensitive contains | `string` |
| `notILike` | Case-insensitive not contains | `string` |
| `eq` | Equals (date-aware) | `string` |
| `ne` | Not equals | `string` |
| `inArray` | Value in list | `string[]` |
| `notInArray` | Value not in list | `string[]` |
| `lt` / `lte` / `gt` / `gte` | Comparison | `string` or `number` |
| `isBetween` | Range (date or numeric) | `[string, string]` |
| `isRelativeToToday` | Relative date (e.g., "-7 days") | `string` |
| `isEmpty` / `isNotEmpty` | Null or empty string check | — |

## Layer 2: Hono Handler

Each table gets a `GET /table` endpoint that accepts URL params from `useDataTable`.

### Query param contract

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | `number` | `1` | 1-based page index |
| `perPage` | `number` | `10` | Rows per page (max 100) |
| `sort` | `string` (JSON) | `[]` | `[{ id: string, desc: boolean }]` |
| `filters` | `string` (JSON) | `[]` | Advanced filter state (FilterList) |
| `joinOperator` | `"and" \| "or"` | `"and"` | How to combine advanced filters |
| `{columnId}` | `string` | — | Simple column filter (Toolbar mode) |

### Response shape

```typescript
{ data: TRow[], pageCount: number }
```

### Full handler example

```typescript
import { getCtx, validation } from '@vobase/core';
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { dataTableConfig } from '@/config/data-table';
import { filterColumns } from '@/lib/filter-columns';
import { contacts } from '../schema';

// Zod schemas for sort and filter validation
const sortItemSchema = z.object({
  id: z.enum(['name', 'email', 'role', 'createdAt', 'updatedAt']),
  desc: z.boolean(),
});

const filterItemSchema = z.object({
  id: z.string(),
  value: z.union([z.string(), z.array(z.string())]),
  variant: z.enum(dataTableConfig.filterVariants),
  operator: z.enum(dataTableConfig.operators),
  filterId: z.string(),
});

const tableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(10),
  sort: z.string().optional().transform((val) => {
    if (!val) return [];
    try { return z.array(sortItemSchema).parse(JSON.parse(val)); }
    catch { return []; }
  }),
  filters: z.string().optional().transform((val) => {
    if (!val) return [];
    try { return z.array(filterItemSchema).parse(JSON.parse(val)); }
    catch { return []; }
  }),
  joinOperator: z.enum(['and', 'or']).default('and'),
  // Simple column filters from DataTableToolbar
  name: z.string().optional(),
  role: z.string().optional(),
  createdAt: z.string().optional(),
});

// Column mapping for sorting
const sortColumns = {
  name: contacts.name,
  email: contacts.email,
  role: contacts.role,
  createdAt: contacts.createdAt,
  updatedAt: contacts.updatedAt,
} as const;

export const contactsHandlers = new Hono()
  .get('/table', async (c) => {
    const { db } = getCtx(c);
    const parsed = tableQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);

    const { page, perPage, sort, filters, joinOperator, name, role, createdAt } = parsed.data;
    const offset = (page - 1) * perPage;

    // Build WHERE: advanced filters OR simple column filters
    let where: ReturnType<typeof filterColumns> | undefined;
    if (filters.length > 0) {
      where = filterColumns({
        table: contacts,
        filters: filters as Parameters<typeof filterColumns<typeof contacts>>[0]['filters'],
        joinOperator,
      });
    } else {
      const conditions = [];

      // Universal search across multiple columns
      if (name) {
        conditions.push(or(
          ilike(contacts.name, `%${name}%`),
          ilike(contacts.email, `%${name}%`),
          ilike(contacts.phone, `%${name}%`),
        ));
      }

      // Multi-select filter
      if (role) {
        const roles = role.split(',').filter(Boolean);
        if (roles.length > 0) {
          conditions.push(roles.length === 1
            ? eq(contacts.role, roles[0])
            : inArray(contacts.role, roles));
        }
      }

      // Date range filter: "from,to" as epoch milliseconds
      if (createdAt) {
        const parts = createdAt.split(',').map(Number).filter(Boolean);
        if (parts.length === 2) {
          conditions.push(and(
            gte(contacts.createdAt, new Date(parts[0])),
            lte(contacts.createdAt, new Date(parts[1])),
          ));
        }
      }

      where = conditions.length > 0 ? and(...conditions) : undefined;
    }

    // Build ORDER BY
    const orderBy = sort.length > 0
      ? sort.map((s) => {
          const col = sortColumns[s.id as keyof typeof sortColumns];
          return s.desc ? desc(col) : asc(col);
        })
      : [desc(contacts.createdAt)];

    // Execute data + count in parallel
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(contacts).where(where)
        .orderBy(...orderBy).limit(perPage).offset(offset),
      db.select({ total: count() }).from(contacts).where(where),
    ]);

    return c.json({ data: rows, pageCount: Math.ceil(total / perPage) });
  });
```

### Key patterns

**Two filter modes**: The handler supports both:
- **Advanced filters** (`filters` JSON param) — from `DataTableFilterList` with per-filter operators. Uses `filterColumns()`.
- **Simple column filters** (individual params like `name`, `role`) — from `DataTableToolbar`. Built manually with Drizzle operators.

**Universal search**: Map a single `name` text filter to `OR(ilike name, ilike email, ilike phone)` on the backend.

**Multi-select**: Frontend sends comma-separated values (e.g., `role=customer,lead`). Backend splits and uses `inArray()`.

**Date range**: Frontend sends epoch milliseconds (e.g., `createdAt=1709251200000,1711929600000`). Backend converts to `Date` objects for `gte`/`lte`.

**Parallel queries**: Always run the data query and count query in `Promise.all()`.

**Sort column mapping**: Map frontend column IDs to Drizzle column references. Only allow sorting on indexed columns.

## Layer 3: Frontend Page

### URL params hook (read-only, for query keys)

```typescript
const ARRAY_SEPARATOR = ',';

function useMyTableSearchParams() {
  const [page] = useQueryState('page', parseAsInteger.withDefault(1));
  const [perPage] = useQueryState('perPage', parseAsInteger.withDefault(10));
  const [sort] = useQueryState('sort',
    getSortingStateParser<MyData>().withDefault([{ id: 'createdAt', desc: true }]));
  const [filterValues] = useQueryStates({
    name: parseAsString.withDefault(''),
    status: parseAsArrayOf(parseAsString, ARRAY_SEPARATOR).withDefault([]),
    createdAt: parseAsArrayOf(parseAsString, ARRAY_SEPARATOR).withDefault([]),
  });

  return {
    page,
    perPage,
    sort: JSON.stringify(sort),
    name: filterValues.name,
    status: filterValues.status.join(ARRAY_SEPARATOR),
    createdAt: filterValues.createdAt.join(ARRAY_SEPARATOR),
  };
}
```

### Data flow

1. `useDataTable` manages URL state via nuqs (writes page/perPage/sort/filters to URL)
2. `useMyTableSearchParams` reads those same URL params (for the TanStack Query key)
3. When URL changes → component re-renders → query key changes → server refetch
4. New `{ data, pageCount }` flows into `useDataTable` → table re-renders

Both hooks read from the same nuqs URL state — there's no conflict because nuqs deduplicates reads.

### Skeleton loading

Use `DataTableSkeleton` for the initial loading state (no data yet), and `placeholderData: (prev) => prev` on the query for smooth transitions when filters change:

```tsx
const { data, isLoading } = useQuery({
  queryKey: ['contacts', searchParams],
  queryFn: () => fetchContacts(searchParams),
  placeholderData: (prev) => prev,
});

// Show skeleton only on first load
{isLoading && !data ? (
  <DataTableSkeleton columnCount={columns.length} filterCount={2} shrinkZero />
) : (
  <DataTable table={table}>
    <DataTableToolbar table={table}>
      <DataTableSortList table={table} />
    </DataTableToolbar>
  </DataTable>
)}
```

## Adding a New Server-Side Table (Checklist)

1. **Define columns** with `meta.variant` and `enableColumnFilter` for filterable columns
2. **Create URL params hook** matching the filterable column IDs
3. **Add Hono handler** with `tableQuerySchema` validation and `filterColumns()` integration
4. **Wire TanStack Query** with URL params as query key and `placeholderData`
5. **Pass to `useDataTable`** with `data`, `pageCount`, `columns`, and `initialState`
6. **Render** `<DataTable>` with `<DataTableToolbar>` and optionally `<DataTableSortList>`
