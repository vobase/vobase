/**
 * ActiveWakesPanel — live list of in-flight wakes from `harness.active_wakes`.
 *
 * Updates via SSE invalidation: any change to `active_wakes` emits a
 * pg_notify with `table: 'active_wakes'`; `use-realtime-invalidation`'s
 * generic fallback maps that to a refetch of the panel's query key.
 *
 * Schema reminder: `active_wakes` is keyed on `conversationId` (one in-flight
 * wake per conversation, debounce-coordinated). No agentId column today, so
 * `PrincipalAvatar` isn't applicable to this row shape — we render the
 * conversation id + worker id directly. When `automations:wake` joins this
 * table with `harness.threads.agentId`, swap to PrincipalAvatar there.
 */

import { Radio } from 'lucide-react'

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { useActivityActiveWakes } from '../hooks/use-activity'

export function ActiveWakesPanel() {
  const { data: wakes = [], isLoading } = useActivityActiveWakes()

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>
  }

  if (wakes.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia>
            <Radio className="size-5" />
          </EmptyMedia>
          <EmptyTitle>No active wakes</EmptyTitle>
          <EmptyDescription>Inbound messages, cron ticks, and staff notes wake agents here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ul className="divide-y divide-border rounded-lg border bg-card">
      {wakes.map((w) => (
        <li key={w.conversationId} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
              <Radio className="size-3.5" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-mono text-foreground text-xs">{w.conversationId}</p>
              <p className="truncate text-muted-foreground text-xs">worker {w.workerId}</p>
            </div>
          </div>
          <div className="shrink-0 text-muted-foreground text-xs">
            <RelativeTimeCard date={w.startedAt} />
          </div>
        </li>
      ))}
    </ul>
  )
}
