import { useChangeProposalsInbox } from '@modules/changes/hooks/use-change-inbox'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Inbox } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'

import { ChangeHistoryList } from '@/components/changes/change-history-list'
import { ProposalRow } from '@/components/changes/proposal-row'
import { PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const searchSchema = z.object({
  tab: z.enum(['pending', 'history']).optional(),
  /** Highlight + scroll to this proposal id when present (e.g. opened from a timeline `change.*` link). */
  id: z.string().min(1).optional(),
})

export const Route = createFileRoute('/_app/changes')({
  validateSearch: searchSchema,
  component: ChangesPage,
})

function ChangesPage() {
  const qc = useQueryClient()
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const tab = search.tab ?? 'pending'
  const highlightId = search.id

  const setTab = (next: 'pending' | 'history') => {
    navigate({ search: (prev) => ({ ...prev, tab: next === 'pending' ? undefined : next }) })
  }

  const { data, isLoading, error } = useChangeProposalsInbox()
  const [filter, setFilter] = useState<string>('all')

  // One-shot auto-switch to History when the linked proposal isn't in the
  // pending inbox (it must already be decided). Latched on `highlightId` so
  // realtime refetches of `data` don't keep bouncing the tab after staff
  // manually flip it.
  const tabSwitchedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!highlightId || !data || search.tab) return
    if (tabSwitchedFor.current === highlightId) return
    if (!data.some((p) => p.id === highlightId)) {
      tabSwitchedFor.current = highlightId
      navigate({ search: (prev) => ({ ...prev, tab: 'history' }) })
    }
  }, [highlightId, data, search.tab, navigate])

  // Per-row mount effects handle scroll/expand/ring — see `ProposalRow` and
  // `HistoryRow`. Doing it here from the page caused races when the matching
  // row hadn't mounted yet (history-tab data loads inside `ChangeHistoryList`
  // and isn't visible to this effect's deps).

  const moduleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of data ?? []) {
      counts.set(p.resourceModule, (counts.get(p.resourceModule) ?? 0) + 1)
    }
    return [...counts.entries()].sort(([, a], [, b]) => b - a)
  }, [data])

  const visible = useMemo(() => {
    if (!data) return []
    if (filter === 'all') return data
    return data.filter((p) => p.resourceModule === filter)
  }, [data, filter])

  return (
    <PageLayout>
      <PageHeader
        title="Changes"
        description="Review what your agents have proposed before it lands in production data."
        className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      />

      <PageBody>
        <div className="mx-auto w-full max-w-4xl">
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'pending' | 'history')} className="space-y-4">
            <TabsList>
              <TabsTrigger value="pending">
                Pending{typeof data?.length === 'number' && data.length > 0 ? ` (${data.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="space-y-4">
              {moduleCounts.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <FilterChip
                    label="All"
                    count={data?.length ?? 0}
                    active={filter === 'all'}
                    onClick={() => setFilter('all')}
                  />
                  {moduleCounts.map(([mod, count]) => (
                    <FilterChip
                      key={mod}
                      label={mod}
                      count={count}
                      active={filter === mod}
                      onClick={() => setFilter(mod)}
                    />
                  ))}
                </div>
              )}

              {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-48 w-full rounded-lg" />)}

              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-destructive text-sm">
                  {error instanceof Error ? error.message : 'Failed to load proposals'}
                </div>
              )}

              {data && visible.length === 0 && (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia>
                      <Inbox className="size-6" />
                    </EmptyMedia>
                    <EmptyTitle>
                      {filter === 'all' ? 'No pending proposals' : `Nothing pending in ${filter}`}
                    </EmptyTitle>
                    <EmptyDescription>
                      {filter === 'all'
                        ? 'When agents suggest edits to memory, contacts, drive files, or skills, they will queue up here for your review.'
                        : 'Switch filters to see proposals in other modules, or wait for an agent to suggest something here.'}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}

              {data && visible.length > 0 && (
                <ul className="space-y-4">
                  {visible.map((proposal) => (
                    <li key={proposal.id} data-proposal-id={proposal.id} className="rounded-lg">
                      <ProposalRow
                        proposal={proposal}
                        highlight={proposal.id === highlightId}
                        onDecided={() => qc.invalidateQueries({ queryKey: ['change_proposals'] })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="history">
              <ChangeHistoryList highlightId={highlightId} />
            </TabsContent>
          </Tabs>
        </div>
      </PageBody>
    </PageLayout>
  )
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium text-xs transition-colors',
        active
          ? 'border-foreground/20 bg-foreground/5 text-foreground'
          : 'border-border bg-transparent text-muted-foreground hover:border-foreground/20 hover:bg-muted/40 hover:text-foreground',
      )}
    >
      <span className="capitalize">{label}</span>
      <span className={cn('rounded-full px-1.5 text-[10px]', active ? 'bg-foreground/10' : 'bg-muted')}>{count}</span>
    </button>
  )
}
