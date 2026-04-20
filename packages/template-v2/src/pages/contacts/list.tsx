import type { Contact } from '@server/contracts/domain-types'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Mail, Phone, Search, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

async function fetchContacts(): Promise<Contact[]> {
  const r = await fetch('/api/contacts')
  if (!r.ok) throw new Error('Failed to load contacts')
  return (await r.json()) as Contact[]
}

export function ContactsListPage() {
  const { data: contacts = [], isLoading, error } = useQuery({ queryKey: ['contacts'], queryFn: fetchContacts })
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter((c) => {
      const hay = [c.displayName ?? '', c.email ?? '', c.phone ?? ''].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [contacts, query])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">Manage customer contacts and their working memory.</p>
        </div>
        <Button size="sm" disabled>
          <UserPlus className="mr-2 size-4" />
          Add contact
        </Button>
      </header>

      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, phone…"
            className="pl-8"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {contacts.length}
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Loading contacts…</div>
        )}
        {error && (
          <div className="m-6 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Failed to load contacts
          </div>
        )}
        {!isLoading && !error && filtered.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <Empty>
              <EmptyMedia>
                <UserPlus className="size-5" />
              </EmptyMedia>
              <EmptyTitle>No contacts yet</EmptyTitle>
              <EmptyDescription>Contacts will appear here as they message your agent.</EmptyDescription>
            </Empty>
          </div>
        )}
        {!isLoading && !error && filtered.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Segments</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id} className="cursor-pointer">
                  <TableCell>
                    <Link
                      to="/contacts/$id"
                      params={{ id: c.id }}
                      className="font-medium text-foreground hover:underline"
                    >
                      {c.displayName ?? '(no name)'}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.email ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="size-3.5" />
                        {c.email}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.phone ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone className="size-3.5" />
                        {c.phone}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.segments.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                      {c.segments.map((s) => (
                        <Badge key={s} variant="secondary" className="font-normal">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {c.createdAt ? <RelativeTimeCard date={c.createdAt} variant="muted" /> : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
