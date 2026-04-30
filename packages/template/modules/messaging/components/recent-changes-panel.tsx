import { useChangeProposalsInbox } from '@modules/changes/hooks/use-change-inbox'

import { RelativeTimeCard } from '@/components/ui/relative-time'

interface RecentChangesPanelProps {
  conversationId: string
}

/** Conversation-scoped slice of the global inbox — filtered client-side so we
 *  inherit the shared query cache (rail badge / /changes page / this panel all
 *  share one fetch). */
export function RecentChangesPanel({ conversationId }: RecentChangesPanelProps) {
  const { data: proposals = [] } = useChangeProposalsInbox()
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
