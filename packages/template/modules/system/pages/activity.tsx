/**
 * /automations — operator-facing dashboard for the automations subsystem.
 *
 * Layout (responsive):
 *  - ActivityBanner (5 stat tiles, full width)
 *  - On wide viewports: AutomationsTable + ActiveWakesPanel side-by-side
 *  - RecentRunsTable below, full width
 */

import { useOrgSetting } from '@modules/settings/hooks/use-org-setting'
import { createFileRoute } from '@tanstack/react-router'
import { Workflow } from 'lucide-react'

import { InfoCard } from '@/components/info'
import { PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { SettingsToggle } from '@/components/settings'
import { ActiveWakesPanel } from '../components/ActiveWakesPanel'
import { ActivityBanner } from '../components/ActivityBanner'
import { AutomationsTable } from '../components/AutomationsTable'
import { RecentRunsTable } from '../components/RecentRunsTable'

/** Master switch for cron-scheduled reviews — gates whether the rules below fire on schedule. */
function ScheduledReviewsToggle() {
  const heartbeat = useOrgSetting('operatorHeartbeatEnabled')
  return (
    <InfoCard>
      <SettingsToggle
        label="Scheduled reviews"
        description="Master switch for cron-scheduled standalone reviews. When off, only event-triggered rules fire."
        checked={heartbeat.value !== 'false'}
        onCheckedChange={(v) => heartbeat.setValue(v ? 'true' : 'false')}
      />
    </InfoCard>
  )
}

export function AutomationsPage() {
  return (
    <PageLayout>
      <PageHeader
        icon={Workflow}
        title="Automations"
        description="Rules, active wakes, budget, and recent runs across the tenant."
      />
      <PageBody>
        <div className="space-y-6 px-4 py-4 sm:px-6">
          <ActivityBanner />

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="space-y-2 lg:col-span-2">
              <h2 className="font-medium text-foreground text-sm">Rules</h2>
              <ScheduledReviewsToggle />
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

export const Route = createFileRoute('/_app/automations')({
  component: AutomationsPage,
})
