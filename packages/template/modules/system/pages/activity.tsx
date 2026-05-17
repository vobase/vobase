/**
 * /system/activity — operator-facing dashboard for the automations subsystem.
 *
 * Layout (responsive):
 *  - ActivityBanner (5 stat tiles, full width)
 *  - On wide viewports: AutomationsTable + ActiveWakesPanel side-by-side
 *  - RecentRunsTable below, full width
 */

import { createFileRoute } from '@tanstack/react-router'
import { Activity } from 'lucide-react'

import { PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { ActiveWakesPanel } from '../components/ActiveWakesPanel'
import { ActivityBanner } from '../components/ActivityBanner'
import { AutomationsTable } from '../components/AutomationsTable'
import { RecentRunsTable } from '../components/RecentRunsTable'

export function ActivityPage() {
  return (
    <PageLayout>
      <PageHeader
        icon={Activity}
        title="Activity"
        description="Live automations, wakes, budget, and recent runs across the tenant."
      />
      <PageBody>
        <div className="space-y-6 px-4 py-4 sm:px-6">
          <ActivityBanner />

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="space-y-2 lg:col-span-2">
              <h2 className="font-medium text-foreground text-sm">Automations</h2>
              <AutomationsTable />
            </section>
            <section className="space-y-2 lg:col-span-1">
              <h2 className="font-medium text-foreground text-sm">Active wakes</h2>
              <ActiveWakesPanel />
            </section>
          </div>

          <section className="space-y-2">
            <h2 className="font-medium text-foreground text-sm">Recent runs (24h)</h2>
            <RecentRunsTable />
          </section>
        </div>
      </PageBody>
    </PageLayout>
  )
}

export const Route = createFileRoute('/_app/system/activity')({
  component: ActivityPage,
})
