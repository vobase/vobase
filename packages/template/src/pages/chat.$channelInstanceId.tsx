/**
 * /chat/$channelInstanceId — public chat page for the web widget.
 *
 * Auth: bearer-token only. The widget never uses the better-auth cookie —
 * otherwise the anonymous session would clobber the dashboard session on the
 * same origin. On first visit we mint an anonymous session via
 * `POST /api/channels/adapters/web/anonymous-session` and cache the token in
 * `localStorage`. Every API call rides `Authorization: Bearer <token>` with
 * `credentials: 'omit'`. `?token=` in the URL (embed flows) still wins.
 *
 * Layout query param:
 *   - `?layout=iframe`     — compact, edge-to-edge, no header. Default when embedded.
 *   - `?layout=standalone` — centered column with header + bot identity. Default otherwise.
 *   - Legacy `?embed=true` maps to `iframe`.
 *
 * Slash commands:
 *   - `/reset` — discard the stored token and mint a fresh anonymous session.
 */
import { useConversationTyping } from '@modules/messaging/hooks/use-conversation-typing'
import type { Message } from '@modules/messaging/schema'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { Globe } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Shimmer } from '@/components/ai-elements/shimmer'
import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion'
import { DateDivider, type MessageRowKind, MessageRow as SharedMessageRow } from '@/components/message-row'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useSse } from '@/hooks/use-sse'
import { cn } from '@/lib/utils'

type Layout = 'iframe' | 'standalone'

interface InboundResponse {
  received: boolean
  conversationId: string
  messageId: string
  deduplicated: boolean
}

interface PublicInstance {
  id: string
  displayName: string | null
  agentName: string | null
  starters: string[]
}

function getQueryParam(name: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

function resolveLayout(): Layout {
  const explicit = getQueryParam('layout')
  if (explicit === 'iframe' || explicit === 'standalone') return explicit
  if (getQueryParam('embed') === 'true') return 'iframe'
  return 'standalone'
}

function storedConvKey(channelInstanceId: string): string {
  return `vobase.chat.conv.${channelInstanceId}`
}

function storedTokenKey(channelInstanceId: string): string {
  return `vobase.chat.token.${channelInstanceId}`
}

function authFetchInit(token: string | null, init: RequestInit = {}): RequestInit {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) }
  if (token) headers.Authorization = `Bearer ${token}`
  if (init.body && !headers['content-type']) headers['content-type'] = 'application/json'
  return {
    ...init,
    headers,
    credentials: 'omit',
  }
}

async function mintAnonymousToken(): Promise<string> {
  // biome-ignore lint/plugin/no-raw-fetch: anonymous public endpoint with custom credentials handling; typed RPC requires session
  const res = await fetch('/api/channels/adapters/web/anonymous-session', {
    method: 'POST',
    credentials: 'omit',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  if (!res.ok) throw new Error(`anonymous-session ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { token?: string }
  if (!data.token) throw new Error('anonymous-session: missing token')
  return data.token
}

function publicDisplayName(role: Message['role'], agentName: string | null): string {
  switch (role) {
    case 'customer':
      return 'You'
    case 'agent':
      return agentName || 'Assistant'
    case 'staff':
      return 'Support'
    default:
      return 'System'
  }
}

function MessageRow({
  msg,
  parent,
  agentName,
  optimistic,
  onOptimisticReply,
}: {
  msg: Message
  parent?: Message
  /** Name to display for agent-authored rows. Falls back to "Assistant" if absent. */
  agentName: string | null
  optimistic?: boolean
  onOptimisticReply?: (btn: { buttonId: string; buttonValue: string; buttonLabel: string }) => void
}) {
  const isCustomer = msg.role === 'customer'
  const authorKind: MessageRowKind = isCustomer ? 'customer' : msg.role === 'agent' ? 'agent' : 'staff'
  const displayName = publicDisplayName(msg.role, agentName)
  return (
    <SharedMessageRow
      msg={msg}
      parent={parent}
      authorKind={authorKind}
      authorLabel={<span className="font-medium text-foreground/80">{displayName}</span>}
      isMine={isCustomer}
      scope="public"
      optimistic={optimistic}
      onCardOptimisticReply={onOptimisticReply}
    />
  )
}

function TypingLine({ label, isIframe }: { label: string; isIframe: boolean }) {
  // Floating strip ABOVE the input form — absolute positioning keeps it
  // off the flex layout, so the scroll area's height (and therefore the
  // visible message stack) never shifts when the indicator appears.
  return (
    <div className="pointer-events-none absolute -top-7 right-0 left-0 z-10 px-4">
      <div className={cn('mx-auto', isIframe ? 'max-w-full' : 'max-w-2xl')}>
        <Shimmer className="text-muted-foreground text-xs">{label}</Shimmer>
      </div>
    </div>
  )
}

export function ChatPage() {
  const { channelInstanceId } = useParams({ from: '/chat/$channelInstanceId' })
  const urlToken = useMemo(() => getQueryParam('token'), [])
  const layout = useMemo(() => resolveLayout(), [])
  const isIframe = layout === 'iframe'
  const [token, setToken] = useState<string | null>(urlToken)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [optimistic, setOptimistic] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [instance, setInstance] = useState<PublicInstance | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Bootstrap: reuse the stored bearer token, or mint a fresh anonymous one.
  // URL-provided `?token=` always wins and is never persisted.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        let effective = urlToken
        if (!effective) {
          const stored = window.localStorage.getItem(storedTokenKey(channelInstanceId))
          effective = stored ?? (await mintAnonymousToken())
          if (!stored) window.localStorage.setItem(storedTokenKey(channelInstanceId), effective)
        }
        if (cancelled) return
        setToken(effective)
        const storedConv = window.localStorage.getItem(storedConvKey(channelInstanceId))
        if (storedConv) setConversationId(storedConv)
        setReady(true)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [channelInstanceId, urlToken])

  // Fetch public instance metadata (name + starters + agent name) — unauthenticated.
  // Re-runs when conversationId is set/changes so the agent name reflects the
  // actual assignee of the live conversation, not just the channel default.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const qs = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''
        // biome-ignore lint/plugin/no-raw-fetch: public anonymous endpoint; typed RPC requires session
        const res = await fetch(
          `/api/channels/adapters/web/instances/${encodeURIComponent(channelInstanceId)}/public${qs}`,
        )
        if (!res.ok) return
        const data = (await res.json()) as PublicInstance
        if (!cancelled) setInstance(data)
      } catch {
        /* non-fatal */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [channelInstanceId, conversationId])

  const refresh = useCallback(
    async (id: string) => {
      try {
        // biome-ignore lint/plugin/no-raw-fetch: anonymous chat session uses bearer token via authFetchInit; typed RPC requires session
        const res = await fetch(
          `/api/channels/adapters/web/conversations/${encodeURIComponent(id)}/messages?limit=100`,
          authFetchInit(token, { method: 'GET' }),
        )
        if (!res.ok) {
          // 403 means the stored conversation belongs to a different anonymous
          // session (token was rotated). Drop the stale ref so the next send
          // starts a fresh conversation instead of polling someone else's.
          if (res.status === 403 || res.status === 404) {
            window.localStorage.removeItem(storedConvKey(channelInstanceId))
            setConversationId(null)
          }
          return
        }
        const rows = (await res.json()) as Message[]
        setMessages(rows)
      } catch (err) {
        console.error('[chat] refresh failed', err)
      }
    },
    [token, channelInstanceId],
  )

  useEffect(() => {
    if (!conversationId || !ready) return
    void refresh(conversationId)
  }, [conversationId, ready, refresh])

  useSse(
    (evt) => {
      if (evt.event !== 'invalidate' || !conversationId) return
      try {
        const payload = JSON.parse(evt.data) as { table?: string; id?: string; action?: string }
        if (payload.action?.startsWith('typing.')) return
        // Org-wide invalidations land here; only refetch when the event
        // names this conversation. Without this gate, every other
        // conversation's chatter triggers a refetch of this widget's
        // transcript.
        if (payload.id !== conversationId) return
        if (
          payload.table === 'messages' ||
          payload.table === 'conversations' ||
          payload.table === 'agent-sessions'
        ) {
          void refresh(conversationId)
        }
      } catch {
        /* ignore malformed events */
      }
    },
    Boolean(conversationId && ready),
  )

  const staffTyping = useConversationTyping(conversationId, 'staff')

  // Autoscroll on new messages or optimistic bubbles.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll-on-list-growth, not full deps
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, optimistic.length])

  const reset = useCallback(async () => {
    setResetting(true)
    setError(null)
    setNotice(null)
    try {
      window.localStorage.removeItem(storedConvKey(channelInstanceId))
      setConversationId(null)
      setMessages([])
      if (!urlToken) {
        window.localStorage.removeItem(storedTokenKey(channelInstanceId))
        const fresh = await mintAnonymousToken()
        window.localStorage.setItem(storedTokenKey(channelInstanceId), fresh)
        setToken(fresh)
      }
      setNotice('Started a fresh anonymous session.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setResetting(false)
    }
  }, [channelInstanceId, urlToken])

  const pushOptimistic = useCallback(
    (kind: 'text' | 'card_reply', content: unknown) => {
      const stub: Message = {
        id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conversationId: conversationId ?? 'pending',
        organizationId: '',
        role: 'customer',
        kind,
        content,
        parentMessageId: null,
        channelExternalId: null,
        status: null,
        attachments: [],
        metadata: {},
        createdAt: new Date(),
      }
      setOptimistic((cur) => [...cur, stub])
    },
    [conversationId],
  )

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      if (trimmed === '/reset') {
        setDraft('')
        await reset()
        return
      }
      setSending(true)
      pushOptimistic('text', { text: trimmed })
      setError(null)
      setNotice(null)
      try {
        const externalMessageId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        // biome-ignore lint/plugin/no-raw-fetch: anonymous chat session uses bearer token + custom headers via authFetchInit; typed RPC requires session
        const res = await fetch(
          '/api/channels/adapters/web/inbound',
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
    [channelInstanceId, token, refresh, reset, pushOptimistic],
  )

  const onCardOptimisticReply = useCallback(
    (btn: { buttonId: string; buttonValue: string; buttonLabel: string }) => {
      pushOptimistic('card_reply', btn)
    },
    [pushOptimistic],
  )

  // Customer-side typing beacon — symmetric to the staff inbox composer.
  // Throttled to one POST per 2s while the user is actively typing; the
  // inbox listens for the resulting SSE event and renders the indicator
  // above its own composer.
  const lastTypingEmitRef = useRef(0)
  const emitTyping = useCallback(() => {
    if (!conversationId || !token) return
    const now = Date.now()
    if (now - lastTypingEmitRef.current < 2000) return
    lastTypingEmitRef.current = now
    // biome-ignore lint/plugin/no-raw-fetch: anonymous chat session uses bearer token via authFetchInit; typed RPC requires session
    void fetch(
      '/api/channels/adapters/web/typing',
      authFetchInit(token, {
        method: 'POST',
        body: JSON.stringify({ conversationId }),
      }),
    ).catch(() => undefined)
  }, [conversationId, token])

  const onSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      void send(draft)
      setDraft('')
    },
    [draft, send],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void send(draft)
        setDraft('')
      }
    },
    [draft, send],
  )

  const botName = instance?.displayName || 'Chat'
  const starters = instance?.starters ?? []
  // Hide once the user has acted — `sending` covers the in-flight POST and
  // `optimistic.length` covers the gap between POST success and refresh
  // landing. Without this, the customer's first message paints the
  // optimistic bubble while the starters + "thinking…" indicator stack on
  // top of each other in the strip above the composer.
  const showStarters =
    messages.length === 0 && optimistic.length === 0 && starters.length > 0 && !sending

  // Drop optimistic entries once their real counterpart lands. Reducer-style
  // setState returns the same reference when nothing changed so React bails
  // on the rerender — no infinite loop, no separate `optimistic` memo.
  useEffect(() => {
    setOptimistic((cur) => {
      if (cur.length === 0) return cur
      const matched = (opt: Message): boolean => {
        if (opt.kind === 'text') {
          const t = (opt.content as { text?: string }).text
          return messages.some(
            (m) => m.role === 'customer' && m.kind === 'text' && (m.content as { text?: string }).text === t,
          )
        }
        if (opt.kind === 'card_reply') {
          const v = (opt.content as { buttonId?: string }).buttonId
          return messages.some(
            (m) =>
              m.role === 'customer' && m.kind === 'card_reply' && (m.content as { buttonId?: string }).buttonId === v,
          )
        }
        return false
      }
      const next = cur.filter((o) => !matched(o))
      return next.length === cur.length ? cur : next
    })
  }, [messages])

  const agentThinking = useMemo(() => {
    if (sending) return true
    if (optimistic.length > 0) return true
    const lastCustomer = messages.findLast((m) => m.role === 'customer')
    if (!lastCustomer) return false
    // Staff replies count as a response too — otherwise the shimmer sticks
    // forever after a human handoff. Treat any non-customer non-system message
    // as "the other side answered".
    const lastResponse = messages.findLast((m) => m.role === 'agent' || m.role === 'staff')
    if (!lastResponse) return true
    return new Date(lastCustomer.createdAt) > new Date(lastResponse.createdAt)
  }, [messages, sending, optimistic.length])

  const indicatorLabel =
    staffTyping && staffTyping.expiresAt > Date.now()
      ? `${staffTyping.name} is typing…`
      : agentThinking && instance?.agentName
        ? `${instance.agentName} is thinking…`
        : null

  const timelineRows = useMemo(() => {
    // Map<id, Message> avoids the O(N²) `messages.find(parentId)` lookup for
    // every card_reply when threads grow long.
    const byId = new Map<string, Message>()
    for (const m of messages) byId.set(m.id, m)
    const rows: React.ReactNode[] = []
    let lastDateKey: string | null = null
    const emit = (m: Message, isOptimistic: boolean) => {
      const d = new Date(m.createdAt)
      const key = d.toDateString()
      if (key !== lastDateKey) {
        rows.push(<DateDivider key={`div-${m.id}`} at={d} />)
        lastDateKey = key
      }
      const parent = m.parentMessageId ? byId.get(m.parentMessageId) : undefined
      rows.push(
        <MessageRow
          key={m.id}
          msg={m}
          parent={parent}
          agentName={instance?.agentName ?? null}
          optimistic={isOptimistic}
          onOptimisticReply={isOptimistic ? undefined : onCardOptimisticReply}
        />,
      )
    }
    for (const m of messages) emit(m, false)
    for (const m of optimistic) emit(m, true)
    return rows
  }, [messages, optimistic, instance?.agentName, onCardOptimisticReply])

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground text-sm">
        Connecting…
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {!isIframe && (
        <header className="flex h-14 shrink-0 items-center border-border border-b px-4">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-3">
            <div
              className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground"
              aria-hidden
            >
              <Globe className="size-4" />
            </div>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-semibold text-sm">{botName}</span>
              <span className="text-muted-foreground text-xs">
                <span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500 align-middle" />
                Online
              </span>
            </div>
          </div>
        </header>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pt-4 pb-12">
        <div
          className={cn(
            'mx-auto flex flex-col gap-3',
            isIframe ? 'max-w-full' : 'max-w-2xl',
            messages.length === 0 && 'h-full items-center justify-center',
          )}
        >
          {messages.length === 0 && optimistic.length === 0 ? (
            <div className="flex max-w-md flex-col items-center gap-2 rounded-lg border border-border bg-card px-4 py-8 text-center">
              <div
                className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground"
                aria-hidden
              >
                <Globe className="size-5" />
              </div>
              <div className="font-semibold text-sm">Hi, I'm {botName}</div>
              <div className="text-muted-foreground text-xs">Ask me anything to get started.</div>
            </div>
          ) : (
            timelineRows
          )}
        </div>
      </div>

      {showStarters && (
        <div className="shrink-0 border-border border-t bg-background px-4 py-2">
          <div className={cn('mx-auto', isIframe ? 'max-w-full' : 'max-w-2xl')}>
            <Suggestions>
              {starters.map((s) => (
                <Suggestion key={s} suggestion={s} onClick={(v) => void send(v)} />
              ))}
            </Suggestions>
          </div>
        </div>
      )}

      {error && (
        <div className="border-destructive border-t bg-destructive/10 px-4 py-2 text-destructive-foreground text-xs">
          {error}
        </div>
      )}
      {notice && (
        <div className="border-border border-t bg-muted px-4 py-2 text-muted-foreground text-xs">{notice}</div>
      )}

      <div className="relative shrink-0">
        {indicatorLabel && <TypingLine label={indicatorLabel} isIframe={isIframe} />}
        <form
          onSubmit={onSubmit}
          className={cn('flex gap-2 border-border border-t bg-card', isIframe ? 'p-3' : 'px-6 py-5')}
        >
          <div className={cn('mx-auto flex w-full gap-2', isIframe ? 'max-w-full' : 'max-w-2xl')}>
            <Textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                if (e.target.value.trim().length > 0) emitTyping()
              }}
              onKeyDown={onKeyDown}
              placeholder="Type a message…  (Shift+Enter for newline · /reset to start over)"
              rows={3}
              className="flex-1 resize-none text-sm"
              disabled={sending || resetting}
            />
            <Button type="submit" disabled={sending || resetting || !draft.trim()} className="self-end">
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/chat/$channelInstanceId')({
  component: ChatPage,
})
