import { type UseChangeHistoryOptions, useChangeHistory } from '@modules/changes/hooks/use-change-history'
import { History } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { HistoryRow } from './history-row'

type StatusFilter = NonNullable<UseChangeHistoryOptions['status']>

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'auto_written', label: 'Auto-applied' },
]

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function ChangeHistoryList() {
  const [status, setStatus] = useState<StatusFilter>('all')
  const { data, isLoading, error } = useChangeHistory({ status })

  const groups = useMemo(() => {
    if (!data) return []
    const byDay = new Map<string, { label: string; rows: typeof data }>()
    for (const row of data) {
      const ts = row.decidedAt ?? row.createdAt
      const key = dayKey(ts)
      const existing = byDay.get(key)
      if (existing) {
        existing.rows.push(row)
      } else {
        byDay.set(key, { label: DAY_FORMAT.format(ts), rows: [row] })
      }
    }
    return [...byDay.entries()].map(([key, value]) => ({ key, ...value }))
  }, [data])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatus(f.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium text-xs transition-colors',
              status === f.value
                ? 'border-foreground/20 bg-foreground/5 text-foreground'
                : 'border-border bg-transparent text-muted-foreground hover:border-foreground/20 hover:bg-muted/40 hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-destructive text-sm">
          {error instanceof Error ? error.message : 'Failed to load history'}
        </div>
      )}

      {data && groups.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <History className="size-6" />
            </EmptyMedia>
            <EmptyTitle>No decided changes yet</EmptyTitle>
            <EmptyDescription>
              Once you approve, reject, or auto-apply a proposal it shows up here as an audit trail.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {groups.map((group) => (
        <section key={group.key} className="space-y-2">
          <div className="sticky top-12 z-[1] bg-background/95 py-1 font-medium text-muted-foreground text-xs uppercase tracking-wide backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {group.label}
          </div>
          <ul className="space-y-2">
            {group.rows.map((row) => (
              <li key={row.id} data-proposal-id={row.id} className="rounded-lg">
                <HistoryRow proposal={row} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
