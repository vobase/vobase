import { RelativeTimeCard } from '@/components/ui/relative-time'
import { usePendingLearnings } from '@/hooks/use-pending-learnings'

interface RecentLearningsPanelProps {
  conversationId: string
}

export function RecentLearningsPanel({ conversationId }: RecentLearningsPanelProps) {
  const { data: learnings = [] } = usePendingLearnings()
  const recent = learnings.filter((l) => l.conversationId === conversationId)

  if (recent.length === 0) {
    return <p className="px-4 pb-4 text-sm text-[var(--color-fg-muted)]">No recent learnings.</p>
  }

  return (
    <ul className="divide-y divide-[var(--color-border-subtle)]">
      {recent.map((learning) => (
        <li key={learning.id} className="px-4 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--color-fg)]">{learning.scope}</span>
            <RelativeTimeCard date={new Date(learning.createdAt)} className="text-[11px] text-muted-foreground" />
          </div>
          {learning.body && (
            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-fg-muted)]">{learning.body}</p>
          )}
          <span className="text-[10px] text-[var(--color-fg-muted)]">{learning.status}</span>
        </li>
      ))}
    </ul>
  )
}
