import { DriveSection } from '@modules/drive/components/drive-section'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { Pencil, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { InfoCard, InfoRow, InfoSection } from '@/components/info'
import { ErrorBanner, PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AttributeTable } from '../components/attribute-table'
import { StaffFormDialog, type StaffFormValues } from '../components/staff-form-dialog'
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
  const update = useUpdateStaff(userId)
  const [editOpen, setEditOpen] = useState(false)

  async function handleSave(values: StaffFormValues) {
    try {
      await update.mutateAsync({
        displayName: values.displayName || null,
        title: values.title || null,
        sectors: values.sectors,
        expertise: values.expertise,
        languages: values.languages,
        capacity: values.capacity,
        availability: values.availability,
        profile: values.profile,
      })
      toast.success('Profile updated')
      setEditOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
  }

  return (
    <PageLayout>
      <PageHeader title={staff?.displayName ?? userId} backTo={{ to: '/team', label: 'Team' }} icon={Users} />

      <PageBody className="space-y-6">
        {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}
        {error && <ErrorBanner>Failed to load staff profile</ErrorBanner>}
        {staff && (
          <>
            <InfoSection
              title="Profile"
              description="Identity, capacity, and routing information."
              actions={
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil />
                  Edit profile
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

            <InfoSection title="Attributes" description="Typed, org-wide custom fields.">
              <AttributeTable userId={userId} values={staff.attributes} />
            </InfoSection>

            <DriveSection
              scope={{ scope: 'staff', userId }}
              rootLabel={staff.displayName ? `${staff.displayName}'s files` : 'Staff files'}
              initialPath="/PROFILE.md"
            />
          </>
        )}
      </PageBody>

      <StaffFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        staff={staff ?? null}
        onSave={handleSave}
        isPending={update.isPending}
      />
    </PageLayout>
  )
}

export const Route = createFileRoute('/_app/team/$userId')({
  component: StaffDetailPage,
})
