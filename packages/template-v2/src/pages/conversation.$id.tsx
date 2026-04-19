import type { Message } from '@server/contracts/domain-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { DeliveryStatusChip } from '@/components/delivery-status-chip'
import { MessageCard } from '@/components/message-card'
import { cn, formatRelativeTime } from '@/lib/utils'

async function fetchMessages(conversationId: string): Promise<Message[]> {
  const res = await fetch(`/api/inbox/conversations/${conversationId}/messages?limit=100`)
  if (!res.ok) throw new Error('Failed to fetch messages')
  return res.json() as Promise<Message[]>
}

async function postNote(conversationId: string, body: string): Promise<void> {
  const res = await fetch(`/api/inbox/conversations/${conversationId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, authorType: 'staff', authorId: 'staff:current' }),
  })
  if (!res.ok) throw new Error('Failed to post note')
}

async function reassignConversation(conversationId: string, assignee: string): Promise<void> {
  const res = await fetch(`/api/inbox/conversations/${conversationId}/reassign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignee }),
  })
  if (!res.ok) throw new Error('Failed to reassign conversation')
}

function InlineNoteForm({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!body.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await postNote(conversationId, body.trim())
      setBody('')
      setOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['messages', conversationId] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted/50"
      >
        + Note
      </button>
    )
  }

  return (
    <div className="border-t border-border px-4 py-3 space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Internal note…"
        rows={3}
        className={cn(
          'w-full rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs',
          'placeholder:text-muted-foreground/60 resize-none focus:outline-none focus:ring-1 focus:ring-ring',
        )}
      />
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={submitting || !body.trim()}
          onClick={handleSubmit}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {submitting ? '…' : 'Post note'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setBody('')
          }}
          className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1.5"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

const ASSIGNEES = [
  { value: 'agent:agt0mer0v1', label: 'Meridian Agent' },
  { value: 'staff:alice', label: 'Alice' },
  { value: 'staff:bob', label: 'Bob' },
]

function ReassignMenu({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient()
  const [reassigning, setReassigning] = useState(false)

  const handleReassign = async (assignee: string) => {
    setReassigning(true)
    try {
      await reassignConversation(conversationId, assignee)
      await queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } finally {
      setReassigning(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-muted-foreground">Reassign:</span>
      <select
        disabled={reassigning}
        onChange={(e) => {
          if (e.target.value) handleReassign(e.target.value)
        }}
        defaultValue=""
        className={cn(
          'text-[11px] rounded border border-border bg-background px-1.5 py-0.5',
          'text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
          'disabled:opacity-50',
        )}
      >
        <option value="" disabled>
          Select…
        </option>
        {ASSIGNEES.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
    </div>
  )
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

  const parentById = useMemo(() => {
    const map = new Map<string, Message>()
    for (const m of messages) map.set(m.id, m)
    return map
  }, [messages])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold truncate">
          Conversation <span className="text-muted-foreground font-mono text-xs">{id}</span>
        </h2>
        <div className="flex items-center gap-3 shrink-0">
          <ReassignMenu conversationId={id} />
        </div>
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
                <DeliveryStatusChip status={msg.status} />
              </div>
              <MessageCard
                message={msg}
                parentMessage={msg.parentMessageId ? parentById.get(msg.parentMessageId) : undefined}
              />
            </div>
          </div>
        ))}
      </div>

      <InlineNoteForm conversationId={id} />
    </div>
  )
}
