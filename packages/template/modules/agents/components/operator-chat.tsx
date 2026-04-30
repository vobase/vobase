/**
 * Operator chat component — staff side of `agent_threads`. Renders the
 * thread's message list (oldest → newest), a composer, and dispatches sends
 * through `agentsClient.threads['{id}'].messages.$post`. Used in two places:
 * the Workspace right rail and the full-page `/agents/threads/$threadId`
 * route.
 *
 * Realtime: invalidates the message-list query on `agent_thread_messages`
 * pg_notify; the existing `use-realtime-invalidation` hook handles the
 * mapping from notify-table to query-key.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { InferResponseType } from 'hono/client'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { agentsClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'

export interface OperatorChatProps {
  threadId: string
  organizationId: string
  /** Compact = right-rail rendering; default = full-page rendering. */
  variant?: 'compact' | 'full'
}

type ThreadMessagesResponse = InferResponseType<(typeof agentsClient.threads)[':id']['messages']['$get'], 200>
type ThreadMessage = ThreadMessagesResponse['rows'][number]

async function fetchMessages(threadId: string): Promise<ThreadMessage[]> {
  const r = await agentsClient.threads[':id'].messages.$get({ param: { id: threadId } })
  if (!r.ok) throw new Error('thread messages fetch failed')
  const body = await r.json()
  return body.rows
}

async function postMessage(input: { threadId: string; organizationId: string; content: string }): Promise<void> {
  const r = await agentsClient.threads[':id'].messages.$post({
    param: { id: input.threadId },
    json: { organizationId: input.organizationId, content: input.content },
  })
  if (!r.ok) throw new Error('thread message send failed')
}

export function OperatorChat({ threadId, organizationId, variant = 'full' }: OperatorChatProps) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['agent_thread_messages', threadId],
    queryFn: () => fetchMessages(threadId),
  })

  const send = useMutation({
    mutationFn: (content: string) => postMessage({ threadId, organizationId, content }),
    onSuccess: () => {
      setDraft('')
      qc.invalidateQueries({ queryKey: ['agent_thread_messages', threadId] })
    },
  })

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || send.isPending) return
    send.mutate(text)
  }

  const isCompact = variant === 'compact'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className={cn('flex-1 overflow-auto', isCompact ? 'p-2 text-xs' : 'p-4 text-sm')}>
        {isLoading ? (
          <div className="text-muted-foreground">Loading messages…</div>
        ) : messages.length === 0 ? (
          <div className="text-muted-foreground">No messages yet. Send the agent your first instruction.</div>
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => (
              <MessageRow key={m.id} message={m} compact={isCompact} />
            ))}
          </ul>
        )}
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-1 border-t p-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the agent…"
          rows={isCompact ? 2 : 3}
          className="resize-none"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSubmit(e)
          }}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!draft.trim() || send.isPending}>
            {send.isPending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function MessageRow({ message, compact }: { message: ThreadMessage; compact: boolean }) {
  const isUser = message.role === 'user'
  return (
    <li className={cn('flex flex-col gap-0.5', isUser ? 'items-end' : 'items-start')}>
      <span className={cn('text-muted-foreground', compact ? 'text-[10px]' : 'text-xs')}>{message.role}</span>
      <div
        className={cn(
          'max-w-[90%] whitespace-pre-wrap rounded-md border px-2 py-1',
          isUser ? 'bg-accent' : 'bg-muted/40',
        )}
      >
        {message.content}
      </div>
    </li>
  )
}
