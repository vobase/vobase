import { createFileRoute, Link } from '@tanstack/react-router'
import {
  type ColumnDef,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table'
import { Settings2, UserPlus, Users2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DataTable } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { useAttributeDefinitions } from '../api/use-attributes'
import { useStaffList, useUpsertStaff } from '../api/use-staff'
import { StaffFormDialog, type StaffFormValues } from '../components/staff-form-dialog'
import type { AttributeValue, Availability, StaffAttributeDefinition, StaffProfile } from '../schema'

const AVAILABILITY_TONE: Record<Availability, string> = {
  active: 'text-emerald-600 dark:text-emerald-400',
  busy: 'text-amber-600 dark:text-amber-400',
  off: 'text-muted-foreground',
  inactive: 'text-muted-foreground opacity-60',
}

const AVAILABILITY_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Busy', value: 'busy' },
  { label: 'Off', value: 'off' },
  { label: 'Inactive', value: 'inactive' },
]

function renderAttributeValue(value: AttributeValue | undefined, type: StaffAttributeDefinition['type']) {
  if (value === undefined || value === null || value === '') {
    return <span className="text-muted-foreground/40">&mdash;</span>
  }
  if (type === 'boolean') return <span className="text-sm">{value === true ? 'Yes' : 'No'}</span>
  return <span className="text-sm text-muted-foreground">{String(value)}</span>
}

function buildAttributeColumn(def: StaffAttributeDefinition): ColumnDef<StaffProfile> {
  return {
    id: `attr_${def.key}`,
    accessorFn: (row) => row.attributes?.[def.key] ?? null,
    header: ({ column }) => <DataTableColumnHeader column={column} label={def.label} />,
    cell: ({ row }) => renderAttributeValue(row.original.attributes?.[def.key], def.type),
    enableSorting: true,
    enableHiding: true,
    meta: { label: def.label },
  }
}

function tagsCell(values: string[]) {
  if (values.length === 0) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((x) => (
        <Badge key={x} variant="secondary" className="font-normal">
          {x}
        </Badge>
      ))}
    </div>
  )
}

export function StaffListPage() {
  const { data: staff = [], isLoading, error } = useStaffList()
  const { data: attrDefs = [] } = useAttributeDefinitions()
  const upsert = useUpsertStaff()
  const [dialogOpen, setDialogOpen] = useState(false)

  const [sorting, setSorting] = useState<SortingState>([{ id: 'displayName', desc: false }])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    userId: false,
    updatedAt: false,
    createdAt: false,
  })
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })

  async function handleSave(values: StaffFormValues) {
    try {
      await upsert.mutateAsync({
        userId: values.userId,
        displayName: values.displayName || null,
        title: values.title || null,
        sectors: values.sectors,
        expertise: values.expertise,
        languages: values.languages,
        capacity: values.capacity,
        availability: values.availability,
        profile: values.profile,
      })
      toast.success('Staff profile saved')
      setDialogOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const tagFilter = (value: unknown, rowValues: string[]) => {
    if (!Array.isArray(value) || value.length === 0) return true
    return value.some((v) => rowValues.includes(v as string))
  }

  const sectorOptions = useMemo(() => {
    const s = new Set<string>()
    for (const r of staff) for (const x of r.sectors) s.add(x)
    return Array.from(s)
      .sort()
      .map((v) => ({ label: v, value: v }))
  }, [staff])

  const expertiseOptions = useMemo(() => {
    const s = new Set<string>()
    for (const r of staff) for (const x of r.expertise) s.add(x)
    return Array.from(s)
      .sort()
      .map((v) => ({ label: v, value: v }))
  }, [staff])

  const languageOptions = useMemo(() => {
    const s = new Set<string>()
    for (const r of staff) for (const x of r.languages) s.add(x)
    return Array.from(s)
      .sort()
      .map((v) => ({ label: v, value: v }))
  }, [staff])

  const columns = useMemo<ColumnDef<StaffProfile>[]>(() => {
    const dynamicCols = attrDefs
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(buildAttributeColumn)

    const staticCols: ColumnDef<StaffProfile>[] = [
      {
        id: 'displayName',
        accessorKey: 'displayName',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Name" />,
        cell: ({ row }) => (
          <Link
            to="/team/$userId"
            params={{ userId: row.original.userId }}
            className="font-medium text-foreground hover:underline"
          >
            {row.original.displayName ?? row.original.userId}
          </Link>
        ),
        meta: { label: 'Name', variant: 'text', placeholder: 'Search name…' },
        enableColumnFilter: true,
        enableSorting: true,
        enableHiding: false,
      },
      {
        id: 'userId',
        accessorKey: 'userId',
        header: ({ column }) => <DataTableColumnHeader column={column} label="User ID" />,
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.userId}</span>,
        meta: { label: 'User ID' },
        enableSorting: false,
      },
      {
        id: 'title',
        accessorKey: 'title',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Title" />,
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.title ?? '—'}</span>,
        meta: { label: 'Title', variant: 'text', placeholder: 'Search title…' },
        enableColumnFilter: true,
        enableSorting: true,
      },
      {
        id: 'sectors',
        accessorKey: 'sectors',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Sectors" />,
        cell: ({ row }) => tagsCell(row.original.sectors),
        filterFn: (row, id, value) => tagFilter(value, row.getValue<string[]>(id)),
        meta: { label: 'Sectors', variant: 'multiSelect', options: sectorOptions },
        enableColumnFilter: sectorOptions.length > 0,
        enableSorting: false,
      },
      {
        id: 'expertise',
        accessorKey: 'expertise',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Expertise" />,
        cell: ({ row }) => tagsCell(row.original.expertise),
        filterFn: (row, id, value) => tagFilter(value, row.getValue<string[]>(id)),
        meta: { label: 'Expertise', variant: 'multiSelect', options: expertiseOptions },
        enableColumnFilter: expertiseOptions.length > 0,
        enableSorting: false,
      },
      {
        id: 'languages',
        accessorKey: 'languages',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Languages" />,
        cell: ({ row }) => tagsCell(row.original.languages),
        filterFn: (row, id, value) => tagFilter(value, row.getValue<string[]>(id)),
        meta: { label: 'Languages', variant: 'multiSelect', options: languageOptions },
        enableColumnFilter: languageOptions.length > 0,
        enableSorting: false,
      },
      {
        id: 'capacity',
        accessorKey: 'capacity',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Capacity" />,
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.capacity}</span>,
        meta: { label: 'Capacity' },
        enableSorting: true,
      },
      {
        id: 'availability',
        accessorKey: 'availability',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Availability" />,
        cell: ({ row }) => (
          <span className={`text-xs font-medium ${AVAILABILITY_TONE[row.original.availability] ?? ''}`}>
            {row.original.availability}
          </span>
        ),
        filterFn: (row, id, value) => {
          if (!Array.isArray(value) || value.length === 0) return true
          return value.includes(row.getValue<string>(id))
        },
        meta: { label: 'Availability', variant: 'multiSelect', options: AVAILABILITY_OPTIONS },
        enableColumnFilter: true,
        enableSorting: true,
      },
    ]

    const tailCols: ColumnDef<StaffProfile>[] = [
      {
        id: 'lastSeenAt',
        accessorKey: 'lastSeenAt',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Last seen" />,
        cell: ({ row }) => (row.original.lastSeenAt ? <RelativeTimeCard date={row.original.lastSeenAt} /> : '—'),
        meta: { label: 'Last seen' },
        enableSorting: true,
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Created" />,
        cell: ({ row }) => (row.original.createdAt ? <RelativeTimeCard date={row.original.createdAt} /> : '—'),
        meta: { label: 'Created' },
        enableSorting: true,
      },
      {
        id: 'updatedAt',
        accessorKey: 'updatedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Updated" />,
        cell: ({ row }) => (row.original.updatedAt ? <RelativeTimeCard date={row.original.updatedAt} /> : '—'),
        meta: { label: 'Updated' },
        enableSorting: true,
      },
    ]

    return [...staticCols, ...dynamicCols, ...tailCols]
  }, [attrDefs, sectorOptions, expertiseOptions, languageOptions])

  const table = useReactTable({
    data: staff,
    columns,
    state: { sorting, columnVisibility, pagination },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Team</h1>
          <p className="text-sm text-muted-foreground">Staff profiles — routing, capacity, and operational context.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/team/teams">
              <Users2 className="mr-2 size-4" />
              Teams
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/team/attributes">
              <Settings2 className="mr-2 size-4" />
              Attributes
            </Link>
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <UserPlus className="mr-2 size-4" />
            Add staff
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Failed to load staff
          </div>
        )}
        {isLoading && !staff.length ? (
          <DataTableSkeleton columnCount={columns.length} filterCount={2} />
        ) : (
          <DataTable table={table}>
            <DataTableToolbar table={table} />
          </DataTable>
        )}
      </div>

      <StaffFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        staff={null}
        onSave={handleSave}
        isPending={upsert.isPending}
      />
    </div>
  )
}

export const Route = createFileRoute('/_app/team/')({
  component: StaffListPage,
})
