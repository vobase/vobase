---
name: data-table
description: |
  DiceUI data-table system for building production-ready data tables with server-side filtering, sorting, and pagination. Based on TanStack Table + nuqs URL state + Drizzle ORM backend. Use this skill whenever building, modifying, or debugging data tables — whether adding columns, filters, sort controls, server-side endpoints, or wiring up useDataTable with TanStack Query. Also use when the user mentions "data table", "table filters", "sort list", "column filters", "server-side pagination", "useDataTable", or "nuqs table state".
---

# DiceUI Data Table

A production-ready data table system built on TanStack Table, nuqs (URL state), and DiceUI filter/sort components. Based on the [DiceUI data-table](https://diceui.com/docs/components/radix/data-table) registry and [tablecn](https://github.com/sadmann7/table) reference implementation.

## Architecture Overview

```
Frontend                              Backend
┌─────────────────────────────┐      ┌──────────────────────────┐
│ useDataTable (nuqs URL sync)│      │ Hono handler             │
│   ↓                         │      │   ↓                      │
│ DataTable + DataTableToolbar│ ──→  │ Zod validation           │
│   ↓                         │      │   ↓                      │
│ TanStack Query (queryKey =  │      │ filterColumns() helper   │
│   URL params)               │      │   ↓                      │
│   ↓                         │      │ Drizzle WHERE/ORDER BY   │
│ Server fetches filtered data│ ←──  │   ↓                      │
└─────────────────────────────┘      │ { data, pageCount }      │
                                     └──────────────────────────┘
```

**Key principle**: `useDataTable` owns URL state. TanStack Query reads those same URL params as query keys. When filters change → URL updates → query refetches → new data flows into the table.

## Installation

Install via the DiceUI registry:

```bash
bunx shadcn@latest add "https://diceui.com/r/data-table.json"
```

This installs 16 files:
- 9 components in `src/components/data-table/`
- 3 hooks in `src/hooks/`
- 2 lib files, 1 config, 1 types file

For the sort list (drag-reorderable multi-column sorting), copy `data-table-sort-list.tsx` from the tablecn reference or from an existing implementation. Requires `@/components/ui/sortable` (DiceUI sortable component).

### Post-install fixes

The DiceUI registry has known import issues. After installing, fix these:

1. **Circular self-import** in `data-table.tsx`:
   ```diff
   - import { getColumnPinningStyle } from "@/components/data-table/data-table";
   + import { getColumnPinningStyle } from "@/lib/data-table";
   ```

2. **Wrong type imports** in `data-table-faceted-filter.tsx`, `use-data-table.ts`, `data-table.ts`, `parsers.ts`:
   ```diff
   - import { ... } from "@/components/data-table/data-table";
   + import { ... } from "@/config/data-table";  // for dataTableConfig
   + import type { ... } from "@/types/data-table";  // for types
   ```

3. **Badge variant** — DiceUI may overwrite `badge.tsx`. Check that custom variants (e.g., `success`) are preserved.

4. **format.ts** — DiceUI may overwrite. Restore any custom formatters (e.g., `formatCompactNumber`).

### Prerequisites

- `nuqs` installed with `<NuqsAdapter>` wrapping your app (use `nuqs/adapters/react` for TanStack Router)
- shadcn/ui components: badge, button, calendar, command, dropdown-menu, input, popover, select, separator, slider, table
- For sort list: `@/components/ui/sortable` (DiceUI sortable)

## Quick Start — Client-side Table

For simple tables with small datasets (< 500 rows), use `useReactTable` directly:

```tsx
import { DataTable } from '@/components/data-table/data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import type { ColumnDef } from '@tanstack/react-table';
import { getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, getFacetedRowModel, getFacetedUniqueValues,
  useReactTable } from '@tanstack/react-table';

const columns: ColumnDef<MyData>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} label="Name" />,
    cell: ({ row }) => <span>{row.getValue('name')}</span>,
    meta: { label: 'Name', variant: 'text', placeholder: 'Search...' },
    enableColumnFilter: true,
    enableSorting: true,
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} label="Status" />,
    meta: {
      label: 'Status',
      variant: 'multiSelect',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Inactive', value: 'inactive' },
      ],
    },
    enableColumnFilter: true,
  },
];

function MyTable({ data }: { data: MyData[] }) {
  const table = useReactTable({
    data,
    columns,
    defaultColumn: { enableColumnFilter: false },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
}
```

## Quick Start — Server-side Table

For production tables with server-side filtering, sorting, and pagination. See `references/server-side.md` for the complete backend pattern.

```tsx
import { useQuery } from '@tanstack/react-query';
import { parseAsArrayOf, parseAsInteger, parseAsString,
  useQueryState, useQueryStates } from 'nuqs';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { useDataTable } from '@/hooks/use-data-table';
import { getSortingStateParser } from '@/lib/parsers';

// 1. Read URL params for query keys (useDataTable also reads them for table state)
function useSearchParams() {
  const [page] = useQueryState('page', parseAsInteger.withDefault(1));
  const [perPage] = useQueryState('perPage', parseAsInteger.withDefault(10));
  const [sort] = useQueryState('sort',
    getSortingStateParser<MyData>().withDefault([{ id: 'createdAt', desc: true }]));
  const [filterValues] = useQueryStates({
    name: parseAsString.withDefault(''),
    status: parseAsArrayOf(parseAsString, ',').withDefault([]),
  });
  return {
    page, perPage,
    sort: JSON.stringify(sort),
    name: filterValues.name,
    status: filterValues.status.join(','),
  };
}

// 2. Page component
function MyTablePage() {
  const searchParams = useSearchParams();

  const { data, isLoading } = useQuery({
    queryKey: ['my-data', searchParams],
    queryFn: () => fetchFromServer(searchParams),
    placeholderData: (prev) => prev,  // keep previous data while loading
  });

  const { table } = useDataTable({
    data: data?.data ?? [],
    pageCount: data?.pageCount ?? -1,
    columns,
    initialState: {
      sorting: [{ id: 'createdAt', desc: true }],
    },
  });

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table}>
        <DataTableSortList table={table} />
      </DataTableToolbar>
    </DataTable>
  );
}
```

## Column Meta API

The `DataTableToolbar` auto-renders filter controls based on column `meta.variant`. Set `enableColumnFilter: true` on columns that should have filters.

| Variant | Control | Filter Value Type | Use Case |
|---------|---------|------------------|----------|
| `text` | Input field | `string` | Text search (name, email) |
| `number` | Number input | `string` | Numeric exact match |
| `range` | Slider | `[min, max]` | Numeric range |
| `select` | Faceted filter (single) | `string` | Single option select |
| `multiSelect` | Faceted filter (multi) | `string[]` | Multi-option filter |
| `date` | Date picker | `Date` | Single date |
| `dateRange` | Date range picker | `[Date, Date]` | Date range |
| `boolean` | — | `boolean` | Boolean toggle |

### Column meta fields

```typescript
interface ColumnMeta {
  label?: string;          // Display label (used in toolbar, sort list, view options)
  placeholder?: string;    // Input placeholder for text/number variants
  variant?: FilterVariant; // Filter type (see table above)
  options?: Option[];      // For select/multiSelect: { label, value, count?, icon? }
  range?: [number, number]; // For range variant: [min, max]
  unit?: string;           // For number variant: unit suffix (e.g., "ms")
  icon?: React.FC;         // Column icon
}
```

### Universal search pattern

To create a single search field that searches across multiple columns server-side, put the text filter on the first visible column and handle the multi-column search in the backend:

```tsx
// Frontend: text filter on "name" column, labeled "Search"
{ id: 'name', meta: { label: 'Search', variant: 'text', placeholder: 'Search contacts...' },
  enableColumnFilter: true }

// Backend: "name" param searches across multiple columns
if (name) {
  conditions.push(or(
    ilike(contacts.name, `%${name}%`),
    ilike(contacts.email, `%${name}%`),
    ilike(contacts.phone, `%${name}%`),
  ));
}
```

## Components

| Component | Purpose |
|-----------|---------|
| `DataTable` | Main table with pagination and action bar slot |
| `DataTableToolbar` | Auto-renders filters from column meta + view options |
| `DataTableColumnHeader` | Sortable column header with label |
| `DataTablePagination` | Page navigation with page size selector |
| `DataTableFacetedFilter` | Multi-select faceted filter popover |
| `DataTableSliderFilter` | Range slider filter |
| `DataTableDateFilter` | Date/date-range picker filter |
| `DataTableViewOptions` | Column visibility toggle |
| `DataTableSkeleton` | Loading skeleton placeholder |
| `DataTableSortList` | Multi-column sort with drag reorder (from tablecn) |

## Reference Files

Read these for detailed implementation patterns:

- `references/server-side.md` — Complete backend pattern: Hono handler with Zod validation, `filterColumns()` helper, Drizzle WHERE/ORDER BY, and the frontend wiring with `useDataTable` + TanStack Query
- `references/use-data-table.md` — `useDataTable` hook API reference: props, URL state keys, how manual mode works, and integration with TanStack Query
- `references/components.md` — Detailed API for each component: props, composition patterns, customization

## Troubleshooting

### Filter not rendering in toolbar
Column needs both `meta.variant` set AND `enableColumnFilter: true`. The toolbar only renders filters for columns where `column.getCanFilter()` returns true.

### URL params not syncing
Ensure `<NuqsAdapter>` wraps your app. For TanStack Router, use `nuqs/adapters/react`.

### Server-side data not updating on filter change
The query key must include the URL params. Read them with `useQueryState`/`useQueryStates` independently from `useDataTable` — both read from the same nuqs state.

### Sort list not working
Requires `@/components/ui/sortable` (DiceUI sortable component with `@dnd-kit`). Install: `bunx shadcn@latest add "https://diceui.com/r/sortable.json"`.

### useDataTable pageCount
Pass `pageCount: -1` when unknown (e.g., initial load). Update it from the server response. The hook sets `manualPagination: true` so TanStack Table relies on this value for page navigation.
