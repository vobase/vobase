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
import type { Message } from '@modules/messaging/schema'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { Globe } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Suggestion, Suggestions } from '@/components/ai-elements/suggestion'
import { MessageCard } from '@/components/message-card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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
  const urlToken = useMemo(() => getQueryParam('token'), [])
  const layout = useMemo(() => resolveLayout(), [])
  const isIframe = layout === 'iframe'
  const [token, setToken] = useState<string | null>(urlToken)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
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

  // Fetch public instance metadata (name + starters) — unauthenticated.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // biome-ignore lint/plugin/no-raw-fetch: public anonymous endpoint; typed RPC requires session
        const res = await fetch(`/api/channels/adapters/web/instances/${encodeURIComponent(channelInstanceId)}/public`)
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
  }, [channelInstanceId])

  const refresh = useCallback(
    async (id: string) => {
      try {
        // biome-ignore lint/plugin/no-raw-fetch: anonymous chat session uses bearer token via authFetchInit; typed RPC requires session
        const res = await fetch(
          `/api/messaging/conversations/${id}/messages?limit=100`,
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
          return
        }
        if (payload.table === 'agent-sessions' && payload.id === conversationId) {
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
    [channelInstanceId, token, refresh, reset],
  )

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
  const showStarters = messages.length === 0 && starters.length > 0 && !sending

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

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div
          className={cn(
            'mx-auto flex flex-col gap-3',
            isIframe ? 'max-w-full' : 'max-w-2xl',
            messages.length === 0 && 'h-full items-center justify-center',
          )}
        >
          {messages.length === 0 ? (
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
            messages.map((m) => <MessageRow key={m.id} msg={m} />)
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

      <form
        onSubmit={onSubmit}
        className={cn('flex shrink-0 gap-2 border-border border-t bg-card', isIframe ? 'p-3' : 'px-6 py-5')}
      >
        <div className={cn('mx-auto flex w-full gap-2', isIframe ? 'max-w-full' : 'max-w-2xl')}>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
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
  )
}

export const Route = createFileRoute('/chat/$channelInstanceId')({
  component: ChatPage,
})
