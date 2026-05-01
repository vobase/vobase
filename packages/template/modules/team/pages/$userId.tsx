import { DriveBrowser } from '@modules/drive/components/drive-browser'
import { DriveProvider } from '@modules/drive/components/drive-provider'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { FolderTree, Pencil, Settings2, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { ErrorBanner, PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AttributeTable } from '../components/attribute-table'
import { StaffFormDialog, type StaffFormValues } from '../components/staff-form-dialog'
import { useStaff, useUpdateStaff } from '../hooks/use-staff'

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
      <PageHeader
        title={staff?.displayName ?? userId}
        backTo={{ to: '/team', label: 'Team' }}
        icon={Users}
        description={staff?.title ?? undefined}
        meta={
          staff && (
            <span className="text-muted-foreground text-xs">
              {staff.availability} · capacity {staff.capacity}
            </span>
          )
        }
        actions={
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={!staff}>
            <Pencil className="mr-1 size-3.5" />
            Edit profile
          </Button>
        }
      />

      <PageBody padded={false} scroll={false}>
        {isLoading && <div className="p-6 text-muted-foreground text-sm">Loading…</div>}
        {error && <ErrorBanner className="m-6">Failed to load staff profile</ErrorBanner>}
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          {staff && (
            <>
              <section className="shrink-0 border-border border-b px-6 py-4">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <ProfileStat label="Sectors" items={staff.sectors} />
                  <ProfileStat label="Expertise" items={staff.expertise} />
                  <ProfileStat label="Languages" items={staff.languages} />
                </div>
              </section>

              <section className="shrink-0 border-border border-b px-6 py-4">
                <div className="mb-3 flex items-center gap-2">
                  <Settings2 className="size-4 text-muted-foreground" />
                  <h2 className="font-medium text-sm">Attributes</h2>
                  <span className="text-muted-foreground text-xs">Typed, org-wide custom fields.</span>
                </div>
                <AttributeTable userId={userId} values={staff.attributes} />
              </section>

              <section className="flex min-h-[480px] flex-1 flex-col">
                <div className="flex shrink-0 items-center gap-2 border-border border-b px-6 py-3">
                  <FolderTree className="size-4 text-muted-foreground" />
                  <h2 className="font-medium text-sm">Drive</h2>
                  <span className="text-muted-foreground text-xs">Profile, memory, and per-agent observations.</span>
                </div>
                <div className="min-h-0 flex-1">
                  <DriveProvider
                    scope={{ scope: 'staff', userId }}
                    rootLabel={staff.displayName ? `${staff.displayName}'s files` : 'Staff files'}
                    initialPath="/PROFILE.md"
                  >
                    <DriveBrowser />
                  </DriveProvider>
                </div>
              </section>
            </>
          )}
        </div>
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

function ProfileStat({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="mb-1 font-medium text-muted-foreground text-xs">{label}</div>
      <div className="flex flex-wrap gap-1">
        {items.length === 0 && <span className="text-muted-foreground text-sm">—</span>}
        {items.map((x) => (
          <Badge key={x} variant="secondary" className="font-normal">
            {x}
          </Badge>
        ))}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/team/$userId')({
  component: StaffDetailPage,
})
