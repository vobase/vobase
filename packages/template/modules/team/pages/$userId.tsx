import { DriveSection } from '@modules/drive/components/drive-section'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { Pencil, Plus, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { AttributeFieldControl, type AttributeValue } from '@/components/attributes/attribute-field-control'
import { InfoCard, InfoRow, InfoSection } from '@/components/info'
import { ErrorBanner, PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AttributeFormDialog, type AttributeFormValues } from '../components/attribute-form-dialog'
import { StaffFormDialog, type StaffFormValues } from '../components/staff-form-dialog'
import { useAttributeDefinitions, useCreateDefinition, useSetStaffAttributes } from '../hooks/use-attributes'
import { useStaff, useUpdateStaff } from '../hooks/use-staff'

function TagList({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((x) => (
        <Badge key={x} variant="secondary" className="font-normal">
          {x}
        </Badge>
      ))}
    </div>
  )
}

export function StaffDetailPage() {
  const { userId } = useParams({ from: '/_app/team/$userId' })
  const { data: staff, isLoading, error } = useStaff(userId)
  const { data: attrDefs = [] } = useAttributeDefinitions()
  const update = useUpdateStaff(userId)
  const setAttrs = useSetStaffAttributes(userId)
  const createDef = useCreateDefinition()

  const sortedDefs = [...attrDefs].sort((a, b) => a.sortOrder - b.sortOrder)

  const [editOpen, setEditOpen] = useState(false)
  const [addAttrOpen, setAddAttrOpen] = useState(false)

  const [attrs, setAttrsDraft] = useState<Record<string, AttributeValue>>({})
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set())
  const dirtyRef = useRef(dirtyKeys)
  dirtyRef.current = dirtyKeys

  useEffect(() => {
    if (!staff) return
    setAttrsDraft((prev) => {
      const next: Record<string, AttributeValue> = { ...staff.attributes }
      for (const k of dirtyRef.current) {
        if (k in prev) next[k] = prev[k]
        else delete next[k]
      }
      return next
    })
  }, [staff])

  function setAttr(key: string, value: AttributeValue | null) {
    setAttrsDraft((prev) => {
      const next = { ...prev }
      if (value === null) delete next[key]
      else next[key] = value
      return next
    })
    setDirtyKeys((prev) => new Set(prev).add(key))
  }

  async function handleSaveStaff(values: StaffFormValues) {
    try {
      await update.mutateAsync({
        displayName: values.displayName || null,
        title: values.title || null,
        sectors: values.sectors,
        expertise: values.expertise,
        languages: values.languages,
        capacity: values.capacity,
        availability: values.availability,
      })
      toast.success('Profile updated')
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
      <PageHeader title={staff?.displayName ?? userId} backTo={{ to: '/team', label: 'Team' }} icon={Users} />

      <PageBody className="lg:flex lg:flex-col lg:overflow-hidden">
        {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}
        {error && <ErrorBanner>Failed to load staff profile</ErrorBanner>}
        {staff && (
          <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:overflow-hidden">
            <div className="space-y-6 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
              <InfoSection
                title="Profile"
                actions={
                  <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                    <Pencil />
                    Edit
                  </Button>
                }
              >
                <InfoCard>
                  <InfoRow label="Title" value={staff.title || <span className="text-muted-foreground">—</span>} />
                  <InfoRow label="Availability">
                    <span className="capitalize">{staff.availability}</span>
                  </InfoRow>
                  <InfoRow label="Capacity" value={staff.capacity} />
                  <InfoRow label="Sectors">
                    <TagList items={staff.sectors} />
                  </InfoRow>
                  <InfoRow label="Expertise">
                    <TagList items={staff.expertise} />
                  </InfoRow>
                  <InfoRow label="Languages">
                    <TagList items={staff.languages} />
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
                            idPrefix="staff-attr"
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
              scope={{ scope: 'staff', userId }}
              rootLabel={staff.displayName ? `${staff.displayName}'s files` : 'Staff files'}
              initialPath="/PROFILE.md"
              orientation="vertical"
              className="lg:h-full lg:min-h-0"
            />
          </div>
        )}
      </PageBody>

      {staff && (
        <StaffFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          staff={staff}
          onSave={handleSaveStaff}
          isPending={update.isPending}
        />
      )}
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

export const Route = createFileRoute('/_app/team/$userId')({
  component: StaffDetailPage,
})
