import { DriveBrowser } from '@modules/drive/components/drive-browser'
import { DriveProvider } from '@modules/drive/components/drive-provider'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useParams } from '@tanstack/react-router'
import { ArrowLeft, FolderTree, Mail, Pencil, Phone, Settings2, ShieldOff } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { useUpdateContact } from '../api/use-contacts'
import { AttributeTable } from '../components/attribute-table'
import { ContactFormDialog, type ContactFormValues, normalizeContactForm } from '../components/contact-form-dialog'
import type { Contact } from '../schema'

async function fetchContact(id: string): Promise<Contact> {
  const r = await fetch(`/api/contacts/${id}`)
  if (!r.ok) throw new Error('Failed to load contact')
  return (await r.json()) as Contact
}

export function ContactDetailPage() {
  const { id } = useParams({ from: '/_app/contacts/$id' })
  const { data: contact, isLoading, error } = useQuery({ queryKey: ['contact', id], queryFn: () => fetchContact(id) })
  const [editOpen, setEditOpen] = useState(false)
  const update = useUpdateContact()

  async function handleSave(values: ContactFormValues) {
    try {
      await update.mutateAsync({ id, patch: normalizeContactForm(values) })
      toast.success('Contact updated')
      setEditOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Button asChild size="sm" variant="ghost">
            <Link to="/contacts">
              <ArrowLeft className="mr-1 size-4" />
              Contacts
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">{contact?.displayName ?? 'Contact'}</h1>
            {contact && (
              <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {contact.email && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="size-3" />
                    {contact.email}
                  </span>
                )}
                {contact.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="size-3" />
                    {contact.phone}
                  </span>
                )}
                <span>
                  Added <RelativeTimeCard date={contact.createdAt} />
                </span>
                {contact.marketingOptOut && (
                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                    <ShieldOff className="size-3" />
                    Marketing opt-out
                    {contact.marketingOptOutAt && (
                      <>
                        {' '}
                        (<RelativeTimeCard date={contact.marketingOptOutAt} />)
                      </>
                    )}
                  </span>
                )}
              </div>
            )}
          </div>
          {contact && contact.segments.length > 0 && (
            <div className="hidden flex-wrap items-center gap-1 sm:flex">
              {contact.segments.map((s) => (
                <Badge key={s} variant="secondary" className="font-normal">
                  {s}
                </Badge>
              ))}
            </div>
          )}
          {contact && (
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1 size-3.5" />
              Edit
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden">
        {isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
        {error && (
          <div className="m-6 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Failed to load contact
          </div>
        )}
        {contact && (
          <>
            <section className="shrink-0 border-b border-border px-6 py-4">
              <div className="mb-3 flex items-center gap-2">
                <Settings2 className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-medium">Attributes</h2>
                <span className="text-xs text-muted-foreground">Typed, org-wide custom fields.</span>
              </div>
              <AttributeTable contactId={id} values={contact.attributes} />
            </section>

            <section className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-6 py-3">
                <FolderTree className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-medium">Drive</h2>
                <span className="text-xs text-muted-foreground">Per-contact uploads and notes.</span>
              </div>
              <div className="min-h-0 flex-1">
                <DriveProvider
                  scope={{ scope: 'contact', contactId: id }}
                  rootLabel={contact.displayName ? `${contact.displayName}'s files` : 'Contact files'}
                  initialPath="/PROFILE.md"
                >
                  <DriveBrowser />
                </DriveProvider>
              </div>
            </section>
          </>
        )}
      </div>

      <ContactFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        contact={contact ?? null}
        onSave={handleSave}
        isPending={update.isPending}
      />
    </div>
  )
}

export const Route = createFileRoute('/_app/contacts/$id')({
  component: ContactDetailPage,
})
