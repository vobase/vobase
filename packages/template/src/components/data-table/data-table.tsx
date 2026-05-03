import { flexRender, type Cell, type Header, type Table as TanstackTable } from '@tanstack/react-table'
import { useMemo, type ComponentProps, type ReactNode } from 'react'

import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-viewport'
import { getColumnPinningStyle } from '@/lib/data-table'
import { cn } from '@/lib/utils'

interface DataTableProps<TData> extends ComponentProps<'div'> {
  table: TanstackTable<TData>
  actionBar?: ReactNode
}

function headerLabel<TData>(header: Header<TData, unknown>): ReactNode {
  const meta = header.column.columnDef.meta
  if (meta?.label) return meta.label
  if (header.isPlaceholder) return null
  if (typeof header.column.columnDef.header === 'string') return header.column.columnDef.header
  return null
}

function MobileCardList<TData>({ table }: { table: TanstackTable<TData> }) {
  const rows = table.getRowModel().rows
  const headerGroup = table.getHeaderGroups()[0]
  const headerById = useMemo(() => {
    const m = new Map<string, Header<TData, unknown>>()
    if (headerGroup) {
      for (const h of headerGroup.headers) m.set(h.column.id, h)
    }
    return m
  }, [headerGroup])

  if (!rows.length) {
    return <div className="rounded-md border p-6 text-center text-muted-foreground text-sm">No results.</div>
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div
          key={row.id}
          data-state={row.getIsSelected() && 'selected'}
          className="rounded-md border bg-card p-3 data-[state=selected]:bg-foreground-5"
        >
          <dl className="flex flex-col gap-1.5">
            {row.getVisibleCells().map((cell: Cell<TData, unknown>) => {
              const header = headerById.get(cell.column.id)
              return (
                <div key={cell.id} className="flex items-start justify-between gap-3 text-sm">
                  <dt className="shrink-0 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {header ? headerLabel(header) : null}
                  </dt>
                  <dd className="min-w-0 text-right">{flexRender(cell.column.columnDef.cell, cell.getContext())}</dd>
                </div>
              )
            })}
          </dl>
        </div>
      ))}
    </div>
  )
}

export function DataTable<TData>({ table, actionBar, children, className, ...props }: DataTableProps<TData>) {
  const isMobile = useIsMobile()

  return (
    <div className={cn('flex w-full flex-col gap-2.5 overflow-auto', className)} {...props}>
      {children}
      {isMobile ? (
        <MobileCardList table={table} />
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      style={{
                        ...getColumnPinningStyle({ column: header.column }),
                      }}
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        style={{
                          ...getColumnPinningStyle({ column: cell.column }),
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={table.getAllColumns().length} className="h-24 text-center">
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        <DataTablePagination table={table} />
        {actionBar && table.getFilteredSelectedRowModel().rows.length > 0 && actionBar}
      </div>
    </div>
  )
}
