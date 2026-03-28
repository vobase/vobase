# Data Table Components Reference

## DataTable

Main table component. Renders header, body, pagination, and optional action bar.

```tsx
import { DataTable } from '@/components/data-table/data-table';

<DataTable table={table} actionBar={<MyActionBar />}>
  {/* Children render above the table (e.g., toolbar) */}
  <DataTableToolbar table={table} />
</DataTable>
```

**Props:**
- `table: Table<TData>` — TanStack Table instance (required)
- `actionBar?: React.ReactNode` — Shown below pagination when rows are selected
- `children?: React.ReactNode` — Rendered above the table (toolbar slot)
- `className?: string` — Container className

**Renders:** Toolbar slot → bordered table with pinning support → pagination → action bar.

## DataTableToolbar

Auto-renders filter controls based on column `meta.variant`. Only columns with `enableColumnFilter: true` get filter UI.

```tsx
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';

<DataTableToolbar table={table}>
  {/* Children render in the right side of toolbar */}
  <DataTableSortList table={table} />
</DataTableToolbar>
```

**Props:**
- `table: Table<TData>` — TanStack Table instance (required)
- `children?: React.ReactNode` — Extra controls (right side, before view options)
- `className?: string`

**Auto-renders per variant:**
- `text` → `<Input>` (debounced)
- `number` → `<Input type="number">` with optional unit suffix
- `range` → `<DataTableSliderFilter>`
- `date` / `dateRange` → `<DataTableDateFilter>`
- `select` / `multiSelect` → `<DataTableFacetedFilter>`

Shows a "Reset" button when any filters are active.

## DataTableColumnHeader

Sortable column header. Click to cycle: none → asc → desc → none.

```tsx
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';

header: ({ column }) => <DataTableColumnHeader column={column} label="Name" />
```

**Props:**
- `column: Column<TData>` — TanStack Table column (required)
- `label: string` — Display label (required)
- `className?: string`

Shows sort indicator (arrow up/down) when column is sorted. Dropdown menu with sort options and hide column.

## DataTablePagination

Page navigation with page size selector. Automatically rendered by `DataTable`.

```tsx
import { DataTablePagination } from '@/components/data-table/data-table-pagination';

<DataTablePagination table={table} />
```

**Props:**
- `table: Table<TData>` — TanStack Table instance

Shows: selected row count, rows per page selector (10/20/30/40/50), page X of Y, first/prev/next/last buttons.

## DataTableFacetedFilter

Multi-select filter popover with search, badges, and counts.

```tsx
import { DataTableFacetedFilter } from '@/components/data-table/data-table-faceted-filter';

<DataTableFacetedFilter
  column={column}
  title="Status"
  options={[
    { label: 'Active', value: 'active', icon: CheckIcon },
    { label: 'Inactive', value: 'inactive' },
  ]}
  multiple={true}
/>
```

**Props:**
- `column: Column<TData>` — Column to filter
- `title: string` — Filter label
- `options: Option[]` — `{ label, value, count?, icon? }`
- `multiple?: boolean` — Multi-select (default: true for `multiSelect` variant)

Auto-rendered by `DataTableToolbar` for `select` and `multiSelect` variants using `meta.options`.

## DataTableDateFilter

Date picker filter. Supports single date or date range.

```tsx
<DataTableDateFilter column={column} title="Created" multiple={true} />
```

**Props:**
- `column: Column<TData>` — Column to filter
- `title: string` — Filter label
- `multiple?: boolean` — Date range mode (for `dateRange` variant)

Auto-rendered by `DataTableToolbar` for `date` and `dateRange` variants.

## DataTableSliderFilter

Range slider filter with min/max bounds.

```tsx
<DataTableSliderFilter column={column} title="Price" />
```

**Props:**
- `column: Column<TData>` — Column to filter
- `title: string` — Filter label

Uses `meta.range` for min/max bounds. Auto-rendered for `range` variant.

## DataTableViewOptions

Column visibility toggle dropdown.

```tsx
import { DataTableViewOptions } from '@/components/data-table/data-table-view-options';

<DataTableViewOptions table={table} align="end" />
```

**Props:**
- `table: Table<TData>` — TanStack Table instance
- `align?: 'start' | 'center' | 'end'` — Popover alignment

Shows toggleable list of all hideable columns (where `enableHiding !== false`). Uses `meta.label` for display names.

## DataTableSkeleton

Loading skeleton placeholder.

```tsx
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton';

<DataTableSkeleton
  columnCount={7}
  filterCount={2}
  cellWidths={['10rem', '14rem', '8rem', '6rem', '8rem', '8rem', '3rem']}
  shrinkZero
/>
```

**Props:**
- `columnCount: number` — Number of columns
- `filterCount?: number` — Number of filter skeleton inputs (default: 0)
- `cellWidths?: string[]` — Width per column for realistic skeleton
- `shrinkZero?: boolean` — Use `shrink-0` on cells
- `rowCount?: number` — Number of skeleton rows (default: 10)

## DataTableSortList

Multi-column sort control with drag-to-reorder. From tablecn reference implementation.

```tsx
import { DataTableSortList } from '@/components/data-table/data-table-sort-list';

<DataTableToolbar table={table}>
  <DataTableSortList table={table} />
</DataTableToolbar>
```

**Props:**
- `table: Table<TData>` — TanStack Table instance
- `disabled?: boolean`
- Plus all `PopoverContent` props

**Features:**
- Button shows "Sort" with badge count of active sorts
- Popover with sortable list (drag handles via `@dnd-kit`)
- Per-sort: column selector (command palette) + direction (asc/desc) + remove
- "Add sort" and "Reset sorting" buttons
- Keyboard: `Ctrl+Shift+S` to toggle, `Backspace`/`Delete` to remove

**Requires:** `@/components/ui/sortable` (DiceUI sortable with `@dnd-kit`).

## Composition Patterns

### Toolbar with sort list and extra buttons

```tsx
<DataTable table={table}>
  <DataTableToolbar table={table}>
    <DataTableSortList table={table} />
    <Button size="sm" variant="outline">Export</Button>
  </DataTableToolbar>
</DataTable>
```

Children of `DataTableToolbar` render on the right side, before the view options toggle.

### Table without toolbar (static table)

```tsx
<DataTable table={table} />
```

### Custom action bar for selected rows

```tsx
<DataTable
  table={table}
  actionBar={
    <div className="flex items-center gap-2">
      <span>{table.getFilteredSelectedRowModel().rows.length} selected</span>
      <Button size="sm" onClick={handleBulkDelete}>Delete</Button>
    </div>
  }
>
  <DataTableToolbar table={table} />
</DataTable>
```

The action bar only shows when rows are selected.
