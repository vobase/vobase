import type { Message } from '@server/contracts/domain-types'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { MessageCard } from '@/components/message-card'
import { formatRelativeTime } from '@/lib/utils'

async function fetchMessages(conversationId: string): Promise<Message[]> {
  const res = await fetch(`/api/inbox/conversations/${conversationId}/messages?limit=100`)
  if (!res.ok) throw new Error('Failed to fetch messages')
  return res.json() as Promise<Message[]>
}

export function ConversationPage() {
  const { id } = useParams({ from: '/conversation/$id' })

  const {
    data: messages = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['messages', id],
    queryFn: () => fetchMessages(id),
    enabled: Boolean(id),
  })

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold truncate">
          Conversation <span className="text-muted-foreground font-mono text-xs">{id}</span>
        </h2>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
        {isLoading && (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">Loading messages…</div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Failed to load messages
          </div>
        )}
        {!isLoading && !error && messages.length === 0 && (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">No messages yet</div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'customer' ? 'justify-start' : 'justify-end'}`}>
            <div className="max-w-[70%]">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[11px] font-medium text-muted-foreground capitalize">{msg.role}</span>
                <span className="text-[11px] text-muted-foreground/60">{formatRelativeTime(msg.createdAt)}</span>
              </div>
              <MessageCard message={msg} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
