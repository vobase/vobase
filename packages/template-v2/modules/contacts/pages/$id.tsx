import type { Contact } from '@server/contracts/domain-types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useParams } from '@tanstack/react-router'
import { ArrowLeft, Mail, Phone, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'

async function fetchContact(id: string): Promise<Contact> {
  const r = await fetch(`/api/contacts/${id}`)
  if (!r.ok) throw new Error('Failed to load contact')
  return (await r.json()) as Contact
}

function renderDate(value: Date | string | null): React.ReactNode {
  if (!value) return '—'
  return <RelativeTimeCard date={value} variant="muted" />
}

export function ContactDetailPage() {
  const { id } = useParams({ from: '/_app/contacts/$id' })
  const { data: contact, isLoading, error } = useQuery({ queryKey: ['contact', id], queryFn: () => fetchContact(id) })

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-4">
        <Button asChild size="sm" variant="ghost">
          <Link to="/contacts">
            <ArrowLeft className="mr-1 size-4" />
            Contacts
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold tracking-tight">{contact?.displayName ?? 'Contact'}</h1>
          <p className="text-xs text-muted-foreground">ID: {id}</p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Failed to load contact
          </div>
        )}
        {contact && (
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <User className="size-4" />
                  Profile
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ProfileField label="Name" value={contact.displayName} />
                <ProfileField
                  label="Email"
                  value={
                    contact.email ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="size-3.5 text-muted-foreground" />
                        {contact.email}
                      </span>
                    ) : null
                  }
                />
                <ProfileField
                  label="Phone"
                  value={
                    contact.phone ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone className="size-3.5 text-muted-foreground" />
                        {contact.phone}
                      </span>
                    ) : null
                  }
                />
                <ProfileField label="Created" value={renderDate(contact.createdAt)} />
                <ProfileField label="Updated" value={renderDate(contact.updatedAt)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Segments</CardTitle>
              </CardHeader>
              <CardContent>
                {contact.segments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No segments assigned.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {contact.segments.map((s) => (
                      <Badge key={s} variant="secondary">
                        {s}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Marketing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <ProfileField label="Opted out" value={contact.marketingOptOut ? 'Yes' : 'No'} />
                {contact.marketingOptOutAt && (
                  <ProfileField label="Opt-out at" value={renderDate(contact.marketingOptOutAt)} />
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-base">Working memory</CardTitle>
              </CardHeader>
              <CardContent>
                {contact.workingMemory ? (
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
                    {contact.workingMemory}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">No working memory yet.</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

function ProfileField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}

export const Route = createFileRoute('/_app/contacts/$id')({
  component: ContactDetailPage,
})
