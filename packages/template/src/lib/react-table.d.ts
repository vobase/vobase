import '@tanstack/react-table';

declare module '@tanstack/react-table' {
  // https://github.com/TanStack/table/issues/44#issuecomment-1377024296
  interface TableMeta<TData> {
    getRowClassName?: (row: Row<TData>) => string;
  }

  interface ColumnMeta {
    headerClassName?: string;
    cellClassName?: string;
    label?: string;
    placeholder?: string;
    variant?: 'text' | 'select' | 'multiSelect';
    options?: { label: string; value: string; count?: number }[];
  }

  interface FilterFns {
    // biome-ignore lint/suspicious/noExplicitAny: TanStack Table FilterFn requires generic parameter
    inDateRange?: FilterFn<any>;
    // biome-ignore lint/suspicious/noExplicitAny: TanStack Table FilterFn requires generic parameter
    arrSome?: FilterFn<any>;
  }

  // https://github.com/TanStack/table/discussions/4554
  interface ColumnFiltersOptions<TData extends RowData> {
    filterFns?: Record<string, FilterFn<TData>>;
  }
}
