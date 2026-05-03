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
import { Send, Settings2, Users2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { DataTable } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { ErrorBanner, PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { InviteMemberDialog } from '../components/invite-member-dialog'
import { canInviteMembers, useActiveMember } from '../hooks/use-active-member'
import { useAttributeDefinitions } from '../hooks/use-attributes'
import { useStaffList } from '../hooks/use-staff'
import { useTeamsByUser } from '../hooks/use-teams'
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
  return <span className="text-muted-foreground text-sm">{String(value)}</span>
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

function tagFilter(value: unknown, rowValues: string[]) {
  if (!Array.isArray(value) || value.length === 0) return true
  return value.some((v) => rowValues.includes(v as string))
}

function tagsCell(values: string[]) {
  if (values.length === 0) return <span className="text-muted-foreground text-xs">—</span>
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
  const { data: activeMember } = useActiveMember()
  const { data: teamsByUser } = useTeamsByUser()
  const [inviteOpen, setInviteOpen] = useState(false)
  const canInvite = canInviteMembers(activeMember?.role)

  const [sorting, setSorting] = useState<SortingState>([{ id: 'displayName', desc: false }])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    userId: false,
    updatedAt: false,
    createdAt: false,
  })
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })

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

  const teamOptions = useMemo(() => {
    const s = new Set<string>()
    if (teamsByUser) {
      for (const teams of Object.values(teamsByUser)) for (const t of teams) s.add(t.name)
    }
    return Array.from(s)
      .sort()
      .map((v) => ({ label: v, value: v }))
  }, [teamsByUser])

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
        id: 'teams',
        accessorFn: (row) => (teamsByUser?.[row.userId] ?? []).map((t) => t.name),
        header: ({ column }) => <DataTableColumnHeader column={column} label="Teams" />,
        cell: ({ row }) => {
          const teams = teamsByUser?.[row.original.userId] ?? []
          return tagsCell(teams.map((t) => t.name))
        },
        filterFn: (row, id, value) => tagFilter(value, row.getValue<string[]>(id)),
        meta: { label: 'Teams', variant: 'multiSelect', options: teamOptions },
        enableColumnFilter: teamOptions.length > 0,
        enableSorting: false,
      },
      {
        id: 'userId',
        accessorKey: 'userId',
        header: ({ column }) => <DataTableColumnHeader column={column} label="User ID" />,
        cell: ({ row }) => <span className="font-mono text-muted-foreground text-xs">{row.original.userId}</span>,
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
          <span className={`font-medium text-xs ${AVAILABILITY_TONE[row.original.availability] ?? ''}`}>
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
  }, [attrDefs, sectorOptions, expertiseOptions, languageOptions, teamOptions, teamsByUser])

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
    <PageLayout>
      <PageHeader
        title="Team"
        description="Staff profiles — routing, capacity, and operational context."
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link to="/team/teams">
                <Users2 />
                Teams
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/team/attributes">
                <Settings2 />
                Attributes
              </Link>
            </Button>
            {canInvite && (
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <Send />
                Invite member
              </Button>
            )}
          </>
        }
      />
      <PageBody>
        {error && <ErrorBanner className="mb-3">Failed to load staff</ErrorBanner>}
        {isLoading && !staff.length ? (
          <DataTableSkeleton columnCount={columns.length} filterCount={2} />
        ) : (
          <DataTable table={table}>
            <DataTableToolbar table={table} />
          </DataTable>
        )}
      </PageBody>

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </PageLayout>
  )
}

export const Route = createFileRoute('/_app/team/')({
  component: StaffListPage,
})
