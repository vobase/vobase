import { createFileRoute, Link } from '@tanstack/react-router'
import { Settings2, UserPlus, Users, Users2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useStaffList, useUpsertStaff } from '../api/use-staff'
import { StaffFormDialog, type StaffFormValues } from '../components/staff-form-dialog'

const AVAILABILITY_TONE: Record<string, string> = {
  active: 'text-emerald-600 dark:text-emerald-400',
  busy: 'text-amber-600 dark:text-amber-400',
  off: 'text-muted-foreground',
  inactive: 'text-muted-foreground opacity-60',
}

export function StaffListPage() {
  const { data: staff = [], isLoading, error } = useStaffList()
  const upsert = useUpsertStaff()
  const [query, setQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return staff
    return staff.filter((s) => {
      const hay = [s.displayName ?? '', s.title ?? '', ...s.sectors, ...s.expertise].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [staff, query])

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
        assignmentNotes: values.assignmentNotes,
      })
      toast.success('Staff profile saved')
      setDialogOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
  }

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

      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, title, sectors, expertise…"
          className="max-w-sm"
        />
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {staff.length}
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Loading staff…</div>
        )}
        {error && (
          <div className="m-6 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Failed to load staff
          </div>
        )}
        {!isLoading && !error && filtered.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <Empty>
              <EmptyMedia>
                <Users className="size-5" />
              </EmptyMedia>
              <EmptyTitle>No staff profiles yet</EmptyTitle>
              <EmptyDescription>
                Add a staff profile for every organization member you want to route work to.
              </EmptyDescription>
              <div className="mt-3">
                <Button size="sm" onClick={() => setDialogOpen(true)}>
                  <UserPlus className="mr-2 size-4" />
                  Add staff
                </Button>
              </div>
            </Empty>
          </div>
        )}
        {!isLoading && !error && filtered.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Sectors</TableHead>
                <TableHead>Expertise</TableHead>
                <TableHead className="text-right">Capacity</TableHead>
                <TableHead>Availability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.userId}>
                  <TableCell>
                    <Link
                      to="/team/$userId"
                      params={{ userId: s.userId }}
                      className="font-medium text-foreground hover:underline"
                    >
                      {s.displayName ?? s.userId}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.title ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {s.sectors.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                      {s.sectors.map((x) => (
                        <Badge key={x} variant="secondary" className="font-normal">
                          {x}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {s.expertise.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                      {s.expertise.map((x) => (
                        <Badge key={x} variant="secondary" className="font-normal">
                          {x}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{s.capacity}</TableCell>
                  <TableCell>
                    <span className={`text-xs font-medium ${AVAILABILITY_TONE[s.availability] ?? ''}`}>
                      {s.availability}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
