import { DriveSection } from '@modules/drive/components/drive-section'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { Pencil, Plus, ShieldOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { AttributeFieldControl, type AttributeValue } from '@/components/attributes/attribute-field-control'
import { InfoCard, InfoRow, InfoSection } from '@/components/info'
import { ErrorBanner, PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { contactsClient } from '@/lib/api-client'
import { hydrateContact } from '@/lib/rpc-utils'
import { AttributeFormDialog, type AttributeFormValues } from '../components/attribute-form-dialog'
import { ContactFormDialog, type ContactFormValues, normalizeContactForm } from '../components/contact-form-dialog'
import { useAttributeDefinitions, useCreateDefinition, useSetContactAttributes } from '../hooks/use-attributes'
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
  const { data: attrDefs = [] } = useAttributeDefinitions()
  const update = useUpdateContact()
  const setAttrs = useSetContactAttributes(id)
  const createDef = useCreateDefinition()

  const sortedDefs = [...attrDefs].sort((a, b) => a.sortOrder - b.sortOrder)

  const [editOpen, setEditOpen] = useState(false)
  const [addAttrOpen, setAddAttrOpen] = useState(false)

  const [attrs, setAttrsDraft] = useState<Record<string, AttributeValue>>({})
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set())
  const dirtyRef = useRef(dirtyKeys)
  dirtyRef.current = dirtyKeys

  useEffect(() => {
    if (!contact) return
    setAttrsDraft((prev) => {
      const next: Record<string, AttributeValue> = { ...contact.attributes }
      for (const k of dirtyRef.current) {
        if (k in prev) next[k] = prev[k]
        else delete next[k]
      }
      return next
    })
  }, [contact])

  function setAttr(key: string, value: AttributeValue | null) {
    setAttrsDraft((prev) => {
      const next = { ...prev }
      if (value === null) delete next[key]
      else next[key] = value
      return next
    })
    setDirtyKeys((prev) => new Set(prev).add(key))
  }

  async function handleSaveContact(values: ContactFormValues) {
    try {
      await update.mutateAsync({ id, patch: normalizeContactForm(values) })
      toast.success('Contact updated')
      setEditOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function saveAttributes() {
    if (dirtyKeys.size === 0) return
    const patch: Record<string, AttributeValue> = {}
    for (const k of dirtyKeys) patch[k] = k in attrs ? attrs[k] : null
    try {
      await setAttrs.mutateAsync(patch)
      setDirtyKeys(new Set())
      toast.success('Attributes saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function handleAddAttribute(values: AttributeFormValues) {
    try {
      await createDef.mutateAsync({
        key: values.key,
        label: values.label,
        type: values.type,
        options: values.options,
        showInTable: values.showInTable,
      })
      toast.success('Attribute added')
      setAddAttrOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add attribute')
    }
  }

  return (
    <PageLayout>
      <PageHeader title={contact?.displayName ?? 'Contact'} backTo={{ to: '/contacts', label: 'Contacts' }} />

      <PageBody className="lg:flex lg:flex-col lg:overflow-hidden">
        {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}
        {error && <ErrorBanner>Failed to load contact</ErrorBanner>}
        {contact && (
          <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:overflow-hidden">
            <div className="space-y-6 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
              <InfoSection
                title="Contact"
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

              <InfoSection title="Attributes">
                <div className="space-y-3">
                  <InfoCard>
                    {sortedDefs.map((def) => (
                      <InfoRow key={def.id} label={def.label}>
                        <div className="max-w-[280px]">
                          <AttributeFieldControl
                            def={def}
                            value={attrs[def.key]}
                            onChange={(v) => setAttr(def.key, v)}
                            disabled={setAttrs.isPending}
                            idPrefix="attr"
                          />
                        </div>
                      </InfoRow>
                    ))}
                    <div className="px-4 py-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => setAddAttrOpen(true)}
                      >
                        <Plus />
                        Add attribute
                      </Button>
                    </div>
                  </InfoCard>
                  {dirtyKeys.size > 0 && (
                    <div className="flex items-center justify-end">
                      <Button size="sm" disabled={setAttrs.isPending} onClick={() => void saveAttributes()}>
                        {setAttrs.isPending ? 'Saving…' : `Save (${dirtyKeys.size})`}
                      </Button>
                    </div>
                  )}
                </div>
              </InfoSection>
            </div>

            <DriveSection
              scope={{ scope: 'contact', contactId: id }}
              rootLabel={contact.displayName ? `${contact.displayName}'s files` : 'Contact files'}
              initialPath="/PROFILE.md"
              orientation="vertical"
              className="lg:h-full lg:min-h-0"
            />
          </div>
        )}
      </PageBody>

      <ContactFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        contact={contact ?? null}
        onSave={handleSaveContact}
        isPending={update.isPending}
      />
      <AttributeFormDialog
        open={addAttrOpen}
        onOpenChange={setAddAttrOpen}
        attribute={null}
        onSave={handleAddAttribute}
        isPending={createDef.isPending}
      />
    </PageLayout>
  )
}

export const Route = createFileRoute('/_app/contacts/$id')({
  component: ContactDetailPage,
})
