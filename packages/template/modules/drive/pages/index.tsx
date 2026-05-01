import { createFileRoute } from '@tanstack/react-router'
import { HardDrive } from 'lucide-react'

import { PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { DriveBrowser } from '../components/drive-browser'
import { DriveProvider } from '../components/drive-provider'

export function DrivePage() {
  return (
    <PageLayout>
      <PageHeader
        icon={HardDrive}
        title="Drive"
        description="Organization-scope files — brand, policy, and pricing docs. Contact-scope files live on each contact."
      />
      <PageBody padded={false} scroll={false}>
        <DriveProvider scope={{ scope: 'organization' }} rootLabel="Organization drive">
          <DriveBrowser />
        </DriveProvider>
      </PageBody>
    </PageLayout>
  )
}

export const Route = createFileRoute('/_app/drive/')({
  component: DrivePage,
})
