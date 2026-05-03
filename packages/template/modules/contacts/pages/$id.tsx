import { DriveSection } from '@modules/drive/components/drive-section'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { Pencil, ShieldOff } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { InfoCard, InfoRow, InfoSection } from '@/components/info'
import { ErrorBanner, PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { contactsClient } from '@/lib/api-client'
import { hydrateContact } from '@/lib/rpc-utils'
import { AttributeTable } from '../components/attribute-table'
import { ContactFormDialog, type ContactFormValues, normalizeContactForm } from '../components/contact-form-dialog'
import { useUpdateContact } from '../hooks/use-contacts'
import type { Contact } from '../schema'

async function fetchContact(id: string): Promise<Contact> {
  const r = await contactsClient[':id'].$get({ param: { id } })
  if (!r.ok) throw new Error('Failed to load contact')
  const row = await r.json()
  if ('error' in row) throw new Error('Failed to load contact')
  return hydrateContact(row)
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
    <PageLayout>
      <PageHeader title={contact?.displayName ?? 'Contact'} backTo={{ to: '/contacts', label: 'Contacts' }} />

      <PageBody className="space-y-6">
        {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}
        {error && <ErrorBanner>Failed to load contact</ErrorBanner>}
        {contact && (
          <>
            <InfoSection
              title="Contact"
              description="Identity and routing information."
              actions={
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil />
                  Edit
                </Button>
              }
            >
              <InfoCard>
                <InfoRow label="Email" value={contact.email || <span className="text-muted-foreground">—</span>} />
                <InfoRow label="Phone" value={contact.phone || <span className="text-muted-foreground">—</span>} />
                <InfoRow label="Segments">
                  {contact.segments.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {contact.segments.map((s) => (
                        <Badge key={s} variant="secondary" className="font-normal">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  )}
                </InfoRow>
                <InfoRow label="Marketing">
                  {contact.marketingOptOut ? (
                    <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                      <ShieldOff className="size-3.5" />
                      Opted out
                      {contact.marketingOptOutAt && (
                        <>
                          {' '}
                          (<RelativeTimeCard date={contact.marketingOptOutAt} />)
                        </>
                      )}
                    </span>
                  ) : (
                    <span>Subscribed</span>
                  )}
                </InfoRow>
                <InfoRow label="Added">
                  <RelativeTimeCard date={contact.createdAt} />
                </InfoRow>
              </InfoCard>
            </InfoSection>

            <InfoSection title="Attributes" description="Typed, org-wide custom fields.">
              <AttributeTable contactId={id} values={contact.attributes} />
            </InfoSection>

            <DriveSection
              scope={{ scope: 'contact', contactId: id }}
              rootLabel={contact.displayName ? `${contact.displayName}'s files` : 'Contact files'}
              initialPath="/PROFILE.md"
            />
          </>
        )}
      </PageBody>

      <ContactFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        contact={contact ?? null}
        onSave={handleSave}
        isPending={update.isPending}
      />
    </PageLayout>
  )
}

export const Route = createFileRoute('/_app/contacts/$id')({
  component: ContactDetailPage,
})
