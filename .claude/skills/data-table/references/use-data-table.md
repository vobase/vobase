# useDataTable Hook Reference

The `useDataTable` hook from `@/hooks/use-data-table` manages table state with automatic URL sync via nuqs. It creates a TanStack Table instance with `manualPagination`, `manualSorting`, and `manualFiltering` enabled — the server handles all data operations.

## Props

```typescript
interface UseDataTableProps<TData> {
  // Required
  data: TData[];                    // Current page data from server
  columns: ColumnDef<TData>[];      // Column definitions
  pageCount: number;                // Total pages (-1 if unknown)

  // Optional
  initialState?: {
    sorting?: ExtendedColumnSort<TData>[];  // Default sort
    pagination?: { pageSize: number };      // Default page size (default: 10)
    columnVisibility?: VisibilityState;     // Hidden columns
    rowSelection?: RowSelectionState;       // Pre-selected rows
  };
  queryKeys?: Partial<QueryKeys>;   // Custom URL param names
  history?: 'push' | 'replace';    // URL update mode (default: 'replace')
  debounceMs?: number;              // Filter debounce (default: 300)
  throttleMs?: number;              // URL update throttle (default: 50)
  clearOnDefault?: boolean;         // Remove default values from URL
  enableAdvancedFilter?: boolean;   // Use FilterList instead of Toolbar filters
  scroll?: boolean;                 // Scroll to top on URL change
  shallow?: boolean;                // Shallow URL updates (default: true)
  startTransition?: React.TransitionStartFunction;  // React transition
}
```

## Return value

```typescript
{ table: Table<TData>, shallow: boolean, debounceMs: number, throttleMs: number }
```

## URL state keys

Default keys (customizable via `queryKeys` prop):

| Key | Default | Parser | Description |
|-----|---------|--------|-------------|
| `page` | `"page"` | `parseAsInteger` | 1-based page index |
| `perPage` | `"perPage"` | `parseAsInteger` | Page size |
| `sort` | `"sort"` | `getSortingStateParser` | JSON-serialized sort state |
| `filters` | `"filters"` | `getFiltersStateParser` | JSON-serialized advanced filters |
| `joinOperator` | `"joinOperator"` | `parseAsStringEnum` | "and" or "or" |

Column filters (from Toolbar) use the column ID as the URL key:
- Text columns: `?name=john` (single string)
- Multi-select columns: `?role=customer,lead` (comma-separated)

## How it works internally

1. **Reads URL** on mount via nuqs hooks (`useQueryState`, `useQueryStates`)
2. **Creates filter parsers** from columns with `enableColumnFilter: true`:
   - Columns with `meta.options` → `parseAsArrayOf(parseAsString, ",")`
   - All other columns → `parseAsString`
3. **Initializes `columnFilters`** from URL values
4. **On filter change** (`onColumnFiltersChange`):
   - Updates local `columnFilters` state immediately (for responsive UI)
   - Debounces URL update (300ms default)
   - Resets page to 1
5. **On sort/page change**: Updates URL immediately (no debounce)

## Integration with TanStack Query

The hook owns URL state but doesn't fetch data. You fetch data separately and pass it in:

```typescript
// 1. Read URL params independently (for query key)
const params = useMySearchParams();

// 2. Fetch data
const { data } = useQuery({
  queryKey: ['my-table', params],
  queryFn: () => fetchData(params),
  placeholderData: (prev) => prev,
});

// 3. Pass fetched data to useDataTable
const { table } = useDataTable({
  data: data?.data ?? [],
  pageCount: data?.pageCount ?? -1,
  columns,
});
```

Both `useDataTable` and `useMySearchParams` read the same nuqs URL state. When `useDataTable` writes a filter change to the URL, the component re-renders, `useMySearchParams` reads the new value, the query key changes, and TanStack Query refetches.

## Common patterns

### Custom query keys (multi-table pages)

```typescript
const { table } = useDataTable({
  data,
  pageCount,
  columns,
  queryKeys: {
    page: 'contactsPage',
    perPage: 'contactsPerPage',
    sort: 'contactsSort',
  },
});
```

### Hidden columns by default

```typescript
const { table } = useDataTable({
  data,
  pageCount,
  columns,
  initialState: {
    columnVisibility: { updatedAt: false, metadata: false },
  },
});
```

### Custom debounce for text filters

```typescript
const { table } = useDataTable({
  data,
  pageCount,
  columns,
  debounceMs: 500,  // slower debounce for expensive server queries
});
```
