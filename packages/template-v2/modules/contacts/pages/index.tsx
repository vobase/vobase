import { useQuery } from '@tanstack/react-query'
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
import { Mail, MoreHorizontal, Pencil, Phone, Settings2, UserPlus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { DataTable } from '@/components/data-table/data-table'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { DataTableSkeleton } from '@/components/data-table/data-table-skeleton'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { useAttributeDefinitions } from '../api/use-attributes'
import { useCreateContact, useUpdateContact } from '../api/use-contacts'
import { ContactFormDialog, type ContactFormValues, normalizeContactForm } from '../components/contact-form-dialog'
import type { AttributeValue, Contact, ContactAttributeDefinition } from '../schema'

async function fetchContacts(): Promise<Contact[]> {
  const r = await fetch('/api/contacts')
  if (!r.ok) throw new Error('Failed to load contacts')
  return (await r.json()) as Contact[]
}

function renderAttributeValue(value: AttributeValue | undefined, type: ContactAttributeDefinition['type']) {
  if (value === undefined || value === null || value === '') {
    return <span className="text-muted-foreground/40">&mdash;</span>
  }
  if (type === 'boolean') return <span className="text-sm">{value === true ? 'Yes' : 'No'}</span>
  return <span className="text-sm text-muted-foreground">{String(value)}</span>
}

function buildAttributeColumn(def: ContactAttributeDefinition): ColumnDef<Contact> {
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

export function ContactsListPage() {
  const { data: contacts = [], isLoading, error } = useQuery({ queryKey: ['contacts'], queryFn: fetchContacts })
  const { data: attrDefs = [] } = useAttributeDefinitions()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Contact | null>(null)
  const create = useCreateContact()
  const update = useUpdateContact()

  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({ updatedAt: false, id: false })
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = useCallback((c: Contact) => {
    setEditing(c)
    setDialogOpen(true)
  }, [])

  async function handleSave(values: ContactFormValues) {
    const payload = normalizeContactForm(values)
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, patch: payload })
        toast.success('Contact updated')
      } else {
        await create.mutateAsync(payload)
        toast.success('Contact created')
      }
      setDialogOpen(false)
      setEditing(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const segmentOptions = useMemo(() => {
    const set = new Set<string>()
    for (const c of contacts) for (const s of c.segments) set.add(s)
    return Array.from(set)
      .sort()
      .map((s) => ({ label: s, value: s }))
  }, [contacts])

  const columns = useMemo<ColumnDef<Contact>[]>(() => {
    const dynamicCols = attrDefs
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(buildAttributeColumn)

    const staticCols: ColumnDef<Contact>[] = [
      {
        id: 'displayName',
        accessorKey: 'displayName',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Name" />,
        cell: ({ row }) => (
          <Link
            to="/contacts/$id"
            params={{ id: row.original.id }}
            className="font-medium text-foreground hover:underline"
          >
            {row.original.displayName ?? '(no name)'}
          </Link>
        ),
        meta: { label: 'Name', variant: 'text', placeholder: 'Search name…' },
        enableColumnFilter: true,
        enableSorting: true,
        enableHiding: false,
      },
      {
        id: 'email',
        accessorKey: 'email',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Email" />,
        cell: ({ row }) => {
          const email = row.original.email
          if (!email) return <span className="text-muted-foreground/40">&mdash;</span>
          return (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Mail className="size-3.5 shrink-0" />
              {email}
            </span>
          )
        },
        meta: { label: 'Email', variant: 'text', placeholder: 'Search email…' },
        enableColumnFilter: true,
        enableSorting: true,
      },
      {
        id: 'phone',
        accessorKey: 'phone',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Phone" />,
        cell: ({ row }) => {
          const phone = row.original.phone
          if (!phone) return <span className="text-muted-foreground/40">&mdash;</span>
          return (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Phone className="size-3.5 shrink-0" />
              {phone}
            </span>
          )
        },
        meta: { label: 'Phone' },
        enableSorting: false,
      },
      {
        id: 'segments',
        accessorKey: 'segments',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Segments" />,
        cell: ({ row }) => {
          const segments = row.original.segments
          if (segments.length === 0) return <span className="text-xs text-muted-foreground">—</span>
          return (
            <div className="flex flex-wrap gap-1">
              {segments.map((s) => (
                <Badge key={s} variant="secondary" className="font-normal">
                  {s}
                </Badge>
              ))}
            </div>
          )
        },
        filterFn: (row, id, value) => {
          const segs = row.getValue<string[]>(id)
          if (!Array.isArray(value) || value.length === 0) return true
          return value.some((v: string) => segs.includes(v))
        },
        meta: { label: 'Segments', variant: 'multiSelect', options: segmentOptions },
        enableColumnFilter: segmentOptions.length > 0,
        enableSorting: false,
      },
      {
        id: 'marketingOptOut',
        accessorKey: 'marketingOptOut',
        header: ({ column }) => <DataTableColumnHeader column={column} label="Marketing" />,
        cell: ({ row }) =>
          row.original.marketingOptOut ? (
            <Badge variant="outline" className="font-normal">
              Opted out
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
        meta: { label: 'Marketing' },
        enableSorting: true,
      },
    ]

    const tailCols: ColumnDef<Contact>[] = [
      {
        id: 'id',
        accessorKey: 'id',
        header: ({ column }) => <DataTableColumnHeader column={column} label="ID" />,
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.id}</span>,
        meta: { label: 'ID' },
        enableSorting: false,
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
      {
        id: 'actions',
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/contacts/$id" params={{ id: row.original.id }}>
                  View details
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openEdit(row.original)}>
                <Pencil className="mr-2 size-3.5" />
                Edit
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
        enableSorting: false,
        enableHiding: false,
      },
    ]

    return [...staticCols, ...dynamicCols, ...tailCols]
  }, [attrDefs, segmentOptions, openEdit])

  const table = useReactTable({
    data: contacts,
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
          <h1 className="text-lg font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">Manage customer contacts and their working memory.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/contacts/attributes">
              <Settings2 className="mr-2 size-4" />
              Attributes
            </Link>
          </Button>
          <Button size="sm" onClick={openCreate}>
            <UserPlus className="mr-2 size-4" />
            Add contact
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4">
        {error && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Failed to load contacts
          </div>
        )}
        {isLoading && !contacts.length ? (
          <DataTableSkeleton columnCount={columns.length} filterCount={2} />
        ) : (
          <DataTable table={table}>
            <DataTableToolbar table={table} />
          </DataTable>
        )}
      </div>

      <ContactFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditing(null)
        }}
        contact={editing}
        onSave={handleSave}
        isPending={create.isPending || update.isPending}
      />
    </div>
  )
}

export const Route = createFileRoute('/_app/contacts/')({
  component: ContactsListPage,
})
