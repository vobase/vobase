import type { Conversation } from '@server/contracts/domain-types'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { cn, formatRelativeTime } from '@/lib/utils'

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-success/15 text-success',
  awaiting_approval: 'bg-blue/15 text-blue',
  on_hold: 'bg-amber-500/15 text-amber-600',
  resolved: 'bg-muted text-muted-foreground',
  failed: 'bg-destructive/15 text-destructive',
}

async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch('/api/inbox/conversations')
  if (!res.ok) throw new Error('Failed to fetch conversations')
  return res.json() as Promise<Conversation[]>
}

export function InboxPage() {
  const {
    data: conversations = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 60_000,
  })

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h1 className="text-sm font-semibold">Inbox</h1>
        <span className="text-xs text-muted-foreground">{conversations.length} conversations</span>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">Loading…</div>
        )}
        {error && (
          <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Failed to load conversations
          </div>
        )}
        {!isLoading && !error && conversations.length === 0 && (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">No conversations</div>
        )}
        <ul className="divide-y divide-border">
          {conversations.map((conv) => (
            <ConversationRow key={conv.id} conversation={conv} />
          ))}
        </ul>
      </div>
    </div>
  )
}

function ConversationRow({ conversation: c }: { conversation: Conversation }) {
  const statusColor = STATUS_COLORS[c.status] ?? 'bg-muted text-muted-foreground'

  return (
    <li>
      <Link
        to="/conversation/$id"
        params={{ id: c.id }}
        className="flex items-center gap-3 px-5 py-3 hover:bg-accent/50 transition-colors"
        activeProps={{ className: 'bg-accent' }}
      >
        {/* Status dot */}
        <span
          className={cn(
            'inline-flex h-1.5 w-1.5 rounded-full shrink-0',
            c.status === 'active' ? 'bg-success' : 'bg-muted-foreground/40',
          )}
        />

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium truncate">{c.contactId}</span>
            <span className="text-[11px] text-muted-foreground shrink-0">{formatRelativeTime(c.lastMessageAt)}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium', statusColor)}>
              {c.status.replace('_', ' ')}
            </span>
            {c.assignee !== 'unassigned' && (
              <span className="text-[11px] text-muted-foreground truncate">{c.assignee}</span>
            )}
          </div>
        </div>
      </Link>
    </li>
  )
}
