import type { FilterFn, Row, RowData } from '@tanstack/react-table';

declare module '@tanstack/react-table' {
  // https://github.com/TanStack/table/issues/44#issuecomment-1377024296
  interface TableMeta<TData extends unknown> {
    getRowClassName?: (row: Row<TData>) => string;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    headerClassName?: string;
    cellClassName?: string;
    label?: string;
  }

  interface FilterFns {
    inDateRange?: FilterFn<any>;
    arrSome?: FilterFn<any>;
  }

  // https://github.com/TanStack/table/discussions/4554
  interface ColumnFiltersOptions<TData extends RowData> {
    filterFns?: Record<string, FilterFn<TData>>;
  }
}
