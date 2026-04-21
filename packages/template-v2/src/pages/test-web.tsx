/**
 * /test-web — dev-only chat widget for dogfooding the web channel end-to-end.
 *
 * POSTs directly to /api/channel-web/inbound with a browser-computed HMAC-SHA256
 * signature (dev secret — see WEB_CHANNEL_WEBHOOK_SECRET in contacts/seed.ts).
 * SSE invalidation is out of scope here — we poll /messages after each send
 * because the whole round-trip (inbound write + stub agent reply) completes in
 * ~30ms, so polling a handful of times is both simpler and plenty responsive.
 */

import type { Message } from '@modules/inbox/schema'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageCard } from '@/components/message-card'

const ORG_ID = 'mer0tenant'
const CHANNEL_INSTANCE_ID = 'chi00web00'
const WEBHOOK_SECRET = 'dev-secret'
const SESSION_STORAGE_KEY = 'vobase.test-web.session'

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return 'anon-server'
  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY)
  if (existing) return existing
  const fresh = `anon-${Math.random().toString(36).slice(2, 10)}`
  window.localStorage.setItem(SESSION_STORAGE_KEY, fresh)
  return fresh
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

interface InboundResponse {
  received: boolean
  conversationId: string
  messageId: string
  deduplicated: boolean
}

async function postInbound(opts: {
  sessionId: string
  text: string
  externalMessageId: string
}): Promise<InboundResponse> {
  const payload = {
    organizationId: ORG_ID,
    channelType: 'web',
    from: opts.sessionId,
    externalMessageId: opts.externalMessageId,
    content: opts.text,
    contentType: 'text',
    profileName: opts.sessionId,
    timestamp: Date.now(),
  }
  const body = JSON.stringify(payload)
  const hex = await hmacSha256Hex(WEBHOOK_SECRET, body)
  const res = await fetch('/api/channel-web/inbound', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${hex}`,
      'x-channel-secret': WEBHOOK_SECRET,
      'x-channel-instance-id': CHANNEL_INSTANCE_ID,
    },
    body,
  })
  if (!res.ok) throw new Error(`inbound failed (${res.status}): ${await res.text()}`)
  return (await res.json()) as InboundResponse
}

async function fetchMessages(conversationId: string): Promise<Message[]> {
  const res = await fetch(`/api/inbox/conversations/${conversationId}/messages?limit=100`)
  if (!res.ok) throw new Error(`messages fetch failed (${res.status})`)
  return (await res.json()) as Message[]
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

export function TestWebPage() {
  const sessionId = useMemo(() => getOrCreateSessionId(), [])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async (id: string) => {
    try {
      const rows = await fetchMessages(id)
      setMessages(rows)
    } catch (err) {
      console.error('[test-web] refresh failed', err)
    }
  }, [])

  // Poll every 1.2s while a conversation exists so agent replies land promptly.
  useEffect(() => {
    if (!conversationId) return
    const timer = setInterval(() => {
      void refresh(conversationId)
    }, 1200)
    return () => clearInterval(timer)
  }, [conversationId, refresh])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only on message count change
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      setSending(true)
      setError(null)
      try {
        const externalMessageId = `tw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const res = await postInbound({ sessionId, text: trimmed, externalMessageId })
        setConversationId(res.conversationId)
        await refresh(res.conversationId)
        // Short burst of follow-up refreshes so agent reply lands quickly.
        for (const delay of [200, 500, 900, 1500]) {
          setTimeout(() => void refresh(res.conversationId), delay)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSending(false)
      }
    },
    [sessionId, refresh],
  )

  const onSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      void send(draft)
      setDraft('')
    },
    [draft, send],
  )

  const resetSession = useCallback(() => {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
    window.location.reload()
  }, [])

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4">
        <div className="flex items-center gap-3">
          <span className="rounded bg-[var(--color-danger)]/20 px-1.5 py-0.5 font-mono text-2xs font-semibold uppercase tracking-wide text-[var(--color-danger)]">
            dev-only
          </span>
          <span className="text-sm font-semibold">Web channel — test client</span>
          <span className="font-mono text-xs text-[var(--color-fg-muted)]">
            session <span className="text-[var(--color-fg)]">{sessionId}</span>
          </span>
          {conversationId ? (
            <span className="font-mono text-xs text-[var(--color-fg-muted)]">
              conv <span className="text-[var(--color-fg)]">{conversationId}</span>
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={resetSession}
          className="text-xs text-[var(--color-fg-muted)] underline underline-offset-2 hover:text-[var(--color-fg)]"
        >
          reset session
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-6 text-center text-sm text-[var(--color-fg-muted)]">
              Say hi to kick off a conversation. Try: <em>"how much does Pro cost?"</em>, <em>"I want a refund"</em>, or
              just <em>"hey"</em>.
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
          placeholder="Message the support agent…"
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

export const Route = createFileRoute('/test-web')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: TestWebPage,
})
