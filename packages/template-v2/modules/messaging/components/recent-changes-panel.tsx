import { useQuery } from '@tanstack/react-query'

import { RelativeTimeCard } from '@/components/ui/relative-time'
import { changesClient } from '@/lib/api-client'
import { hydrateChangeProposal } from '@/lib/rpc-utils'

interface RecentChangesPanelProps {
  conversationId: string
}

/**
 * Pending change proposals tied to this conversation. Filtered client-side from
 * the global inbox so the panel reuses the existing query cache without a
 * conversation-scoped endpoint.
 */
export function RecentChangesPanel({ conversationId }: RecentChangesPanelProps) {
  const { data: proposals = [] } = useQuery({
    queryKey: ['change_proposals', 'inbox'],
    queryFn: async () => {
      const res = await changesClient.inbox.$get()
      if (!res.ok) throw new Error('Failed to fetch change proposals')
      const body = await res.json()
      return Array.isArray(body) ? body.map(hydrateChangeProposal) : []
    },
    refetchInterval: 30_000,
  })

  const recent = proposals.filter((p) => p.conversationId === conversationId)

  if (recent.length === 0) {
    return <p className="px-4 pb-4 text-[var(--color-fg-muted)] text-sm">No recent changes.</p>
  }

  return (
    <ul className="divide-y divide-[var(--color-border-subtle)]">
      {recent.map((p) => (
        <li key={p.id} className="px-4 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--color-fg)] text-xs">
              {p.resourceModule}:{p.resourceType}
            </span>
            <RelativeTimeCard date={p.createdAt} className="text-mini text-muted-foreground" />
          </div>
          {p.rationale && <p className="mt-0.5 line-clamp-2 text-[var(--color-fg-muted)] text-xs">{p.rationale}</p>}
          <span className="text-2xs text-[var(--color-fg-muted)]">{p.status}</span>
        </li>
      ))}
    </ul>
  )
}
