/**
 * /chat/$channelInstanceId — public chat page for the web widget.
 *
 * Auth modes:
 *   - `?token=<JWT>` — Bearer auth (iframe-embed, dodges 3rd-party cookies).
 *   - No token       — `credentials: 'include'` with anonymous better-auth session.
 *
 * Widget chrome (header) is hidden when `?embed=true`.
 */
import type { Message } from '@server/contracts/domain-types'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageCard } from '@/components/message-card'
import { authClient } from '@/lib/auth-client'

interface InboundResponse {
  received: boolean
  conversationId: string
  messageId: string
  deduplicated: boolean
}

function getQueryParam(name: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

function storedConvKey(channelInstanceId: string): string {
  return `vobase.chat.conv.${channelInstanceId}`
}

function authFetchInit(token: string | null, init: RequestInit = {}): RequestInit {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) }
  if (token) headers.Authorization = `Bearer ${token}`
  if (init.body && !headers['content-type']) headers['content-type'] = 'application/json'
  return {
    ...init,
    headers,
    credentials: token ? 'omit' : 'include',
  }
}

function MessageRow({ msg }: { msg: Message }) {
  const isCustomer = msg.role === 'customer'
  return (
    <div className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[80%]">
        <MessageCard message={msg} />
      </div>
    </div>
  )
}

export function ChatPage() {
  const { channelInstanceId } = useParams({ from: '/chat/$channelInstanceId' })
  const token = useMemo(() => getQueryParam('token'), [])
  const isEmbed = useMemo(() => getQueryParam('embed') === 'true', [])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Bootstrap: ensure anonymous session when no bearer token.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!token) {
          const { data: session } = await authClient.getSession()
          if (!session && !cancelled) {
            await authClient.signIn.anonymous()
          }
        }
        if (!cancelled) {
          const stored = window.localStorage.getItem(storedConvKey(channelInstanceId))
          if (stored) setConversationId(stored)
          setReady(true)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [channelInstanceId, token])

  const refresh = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(
          `/api/inbox/conversations/${id}/messages?limit=100`,
          authFetchInit(token, { method: 'GET' }),
        )
        if (!res.ok) return
        const rows = (await res.json()) as Message[]
        setMessages(rows)
      } catch (err) {
        console.error('[chat] refresh failed', err)
      }
    },
    [token],
  )

  // Initial fetch + SSE invalidation.
  useEffect(() => {
    if (!conversationId || !ready) return
    void refresh(conversationId)
    const es = new EventSource('/api/sse')
    const onInvalidate = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { table?: string; id?: string }
        if (payload.table === 'messages' || payload.table === 'conversations') {
          void refresh(conversationId)
        }
      } catch {
        /* ignore */
      }
    }
    es.addEventListener('invalidate', onInvalidate)
    return () => {
      es.removeEventListener('invalidate', onInvalidate)
      es.close()
    }
  }, [conversationId, ready, refresh])

  // Autoscroll on new messages.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only on message count
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      setSending(true)
      setError(null)
      try {
        const externalMessageId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const res = await fetch(
          '/api/channel-web/inbound',
          authFetchInit(token, {
            method: 'POST',
            headers: { 'x-channel-instance-id': channelInstanceId },
            body: JSON.stringify({ content: trimmed, contentType: 'text', externalMessageId }),
          }),
        )
        if (!res.ok) throw new Error(`inbound ${res.status}: ${await res.text()}`)
        const data = (await res.json()) as InboundResponse
        setConversationId(data.conversationId)
        window.localStorage.setItem(storedConvKey(channelInstanceId), data.conversationId)
        await refresh(data.conversationId)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSending(false)
      }
    },
    [channelInstanceId, token, refresh],
  )

  const onSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      void send(draft)
      setDraft('')
    },
    [draft, send],
  )

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg)] text-sm text-[var(--color-fg-muted)]">
        Connecting…
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
      {!isEmbed ? (
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4">
          <span className="text-sm font-semibold">Chat</span>
          <span className="font-mono text-xs text-[var(--color-fg-muted)]">{channelInstanceId}</span>
        </header>
      ) : null}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-6 text-center text-sm text-[var(--color-fg-muted)]">
              Say hi to kick off a conversation.
            </div>
          ) : (
            messages.map((m) => <MessageRow key={m.id} msg={m} />)
          )}
        </div>
      </div>

      {error ? (
        <div className="border-t border-[var(--color-danger)] bg-[var(--color-danger)]/20 px-4 py-2 text-xs text-[var(--color-fg)]">
          {error}
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="flex shrink-0 gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-3"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-bg)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  )
}

export const Route = createFileRoute('/chat/$channelInstanceId')({
  component: ChatPage,
})
