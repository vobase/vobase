import type { Contact } from '@modules/contacts/schema'
import { deriveContactName } from '@modules/messaging/components/contact'
import { useActivity } from '@modules/messaging/hooks/use-activity'
import { useLifecycle } from '@modules/messaging/hooks/use-lifecycle'
import { useNotes } from '@modules/messaging/hooks/use-notes'
import { useReassign } from '@modules/messaging/hooks/use-reassign'
import { useDismissMention, useUnreadMentions } from '@modules/team/hooks/use-unread-mentions'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { CheckIcon, PanelRightOpenIcon, RefreshCcwIcon, RotateCcwIcon } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useEffect, useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { useCurrentUserId } from '@/hooks/use-current-user'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { contactsClient, messagingClient } from '@/lib/api-client'
import type { Conversation, Message } from '../schema'
import { AssigneeBadge } from './assignee-badge'
import type { ChannelTab } from './channel-tab-bar'
import { ChannelTabBar } from './channel-tab-bar'
import { Composer } from './composer'
import { MessageThread } from './message-thread'
import { SnoozeMenu } from './snooze-menu'

const FALLBACK_STAFF_ID = 'staff'

async function fetchConversationsForContact(contactId: string): Promise<Conversation[]> {
  const r = await messagingClient.conversations.$get({ query: { contactId } })
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`)
  return (await r.json()) as unknown as Conversation[]
}

async function fetchMessages(id: string): Promise<Message[]> {
  const r = await messagingClient.conversations[':id'].messages.$get({ param: { id }, query: { limit: '50' } })
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`)
  return (await r.json()) as unknown as Message[]
}

async function fetchMessagingGrouped(): Promise<{
  rows: Conversation[]
  counts: { active: number; later: number; done: number }
}> {
  const r = await messagingClient.conversations.$get({ query: { grouped: '1' } })
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`)
  return (await r.json()) as unknown as {
    rows: Conversation[]
    counts: { active: number; later: number; done: number }
  }
}

async function fetchContact(id: string): Promise<Contact | null> {
  const r = await contactsClient[':id'].$get({ param: { id } })
  if (!r.ok) return null
  return (await r.json()) as unknown as Contact
}

export function ConversationDetail() {
  const params = useParams({ strict: false }) as { contactId: string }
  const contactId = params.contactId
  const navigate = useNavigate()

  const [convParam, setConvParam] = useQueryState('conv')
  const [ctx, setCtx] = useQueryState('ctx', { defaultValue: 'closed' })
  const currentUserId = useCurrentUserId()
  const actingStaffId = currentUserId ?? FALLBACK_STAFF_ID

  const { data: contactConvs = [] } = useQuery({
    queryKey: ['conversations', { contactId }],
    queryFn: () => fetchConversationsForContact(contactId),
  })

  const { data: contact = null } = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => fetchContact(contactId),
  })

  // Filter out email channels per current scope.
  const visibleConvs = useMemo(() => contactConvs.filter((c) => c.channelInstanceType !== 'email'), [contactConvs])

  // Unique channel tabs (one per distinct channelInstanceId), sorted by most-recent activity.
  const tabs = useMemo<ChannelTab[]>(() => {
    const byChannel = new Map<string, { conv: Conversation; latest: number }>()
    for (const c of visibleConvs) {
      const t = c.lastMessageAt ? new Date(c.lastMessageAt).getTime() : 0
      const cur = byChannel.get(c.channelInstanceId)
      if (!cur || t > cur.latest) byChannel.set(c.channelInstanceId, { conv: c, latest: t })
    }
    return [...byChannel.entries()]
      .sort((a, b) => b[1].latest - a[1].latest)
      .map(([channelInstanceId, { conv }]) => ({
        channelInstanceId,
        type: conv.channelInstanceType ?? null,
        label: conv.channelInstanceLabel ?? null,
      }))
  }, [visibleConvs])

  // Selected conversation: ?conv=<id> if present, else most recently active.
  const activeConv = useMemo<Conversation | null>(() => {
    if (visibleConvs.length === 0) return null
    if (convParam) {
      const match = visibleConvs.find((c) => c.id === convParam)
      if (match) return match
    }
    // Most recently active overall.
    return [...visibleConvs].sort((a, b) => {
      const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
      const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
      return tb - ta
    })[0]
  }, [visibleConvs, convParam])

  const activeChannelInstanceId = activeConv?.channelInstanceId ?? null
  const activeConvId = activeConv?.id ?? null

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', activeConvId],
    queryFn: () => (activeConvId ? fetchMessages(activeConvId) : Promise.resolve([])),
    enabled: Boolean(activeConvId),
  })

  const { data: notes = [] } = useNotes(activeConvId ?? '')
  const { data: activity = [] } = useActivity(activeConvId ?? '')

  // Auto-dismiss @-mentions for the current user on the active conversation.
  // Keeps the red "@" badge in conversation-row self-clearing as staff reads.
  const { data: unreadMentions = [] } = useUnreadMentions()
  const dismissMention = useDismissMention()
  useEffect(() => {
    if (!activeConvId) return
    const mine = unreadMentions.filter((m) => m.conversationId === activeConvId)
    for (const m of mine) dismissMention.mutate(m.noteId)
    // dismissMention is a stable mutation object — we only want to rerun when
    // the list of unread mentions or the active conversation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId, unreadMentions, dismissMention.mutate])

  // Conversation-list nav: prev/next walks contactIds from the grouped messaging.
  const { data: grouped } = useQuery({
    queryKey: ['conversations', 'grouped'],
    queryFn: fetchMessagingGrouped,
  })
  const distinctContactIds = useMemo(() => (grouped?.rows ?? []).map((c) => c.contactId), [grouped])

  const idx = distinctContactIds.indexOf(contactId)
  const hasPrev = idx > 0
  const hasNext = idx >= 0 && idx < distinctContactIds.length - 1
  const navigateTo = (targetContactId: string) =>
    navigate({ to: '/inbox/$contactId', params: { contactId: targetContactId } })

  useKeyboardNav({
    context: 'messaging-detail',
    onSelectPrev: hasPrev ? () => navigateTo(distinctContactIds[idx - 1]) : undefined,
    onSelectNext: hasNext ? () => navigateTo(distinctContactIds[idx + 1]) : undefined,
  })

  const reassign = useReassign(activeConvId ?? '')
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['conversations'] })
    if (activeConvId) queryClient.invalidateQueries({ queryKey: ['conversation', activeConvId] })
  }
  const resolveMut = useLifecycle(activeConvId ?? '', 'resolve', actingStaffId)
  const reopenMut = useLifecycle(activeConvId ?? '', 'reopen', actingStaffId)
  const resetMut = useLifecycle(activeConvId ?? '', 'reset', actingStaffId)

  const title = deriveContactName(contact, contactId)
  const subline = contact?.phone ?? contact?.email ?? null

  return (
    <div className="flex h-full flex-col">
      {/* Row 1: contact header + channel tabs */}
      <div className="flex min-h-[52px] w-full items-center gap-6 border-b bg-background px-4 py-1.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate font-semibold text-base">{title}</h1>
          {subline && <span className="shrink-0 text-muted-foreground text-xs">{subline}</span>}
        </div>
        {tabs.length > 1 && (
          <div>
            <ChannelTabBar
              tabs={tabs}
              selectedChannelInstanceId={activeChannelInstanceId}
              onSelect={(chId) => {
                const conv = visibleConvs.find((c) => c.channelInstanceId === chId)
                if (conv) setConvParam(conv.id)
              }}
            />
          </div>
        )}
      </div>

      {/* Row 2: action bar */}
      <div className="flex items-center gap-2 border-b bg-muted/20 px-4 py-1.5">
        <AssigneeBadge
          assignee={activeConv?.assignee ?? null}
          disabled={!activeConvId || reassign.isPending}
          onSelect={(val) => {
            if (activeConvId) reassign.mutate(val)
          }}
        />
        <div className="flex-1" />
        {activeConv?.status === 'active' && activeConvId && (
          <>
            <SnoozeMenu conversationId={activeConvId} by={actingStaffId} onSnoozed={invalidate} />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => resolveMut.mutate()}
              disabled={resolveMut.isPending}
              data-testid="conversation-resolve"
            >
              <CheckIcon className="size-4" />
              Resolve
            </Button>
          </>
        )}
        {activeConv?.status === 'resolved' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => reopenMut.mutate()}
            disabled={reopenMut.isPending}
            data-testid="conversation-reopen"
          >
            <RotateCcwIcon className="size-4" />
            Reopen
          </Button>
        )}
        {activeConv?.status === 'failed' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => resetMut.mutate()}
            disabled={resetMut.isPending}
            data-testid="conversation-reset"
          >
            <RefreshCcwIcon className="size-4" />
            Retry
          </Button>
        )}
        {activeConvId && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={ctx === 'open' ? 'Hide context' : 'Show context'}
            aria-pressed={ctx === 'open'}
            onClick={() => void setCtx(ctx === 'open' ? null : 'open')}
            data-testid="conversation-context-toggle"
          >
            <PanelRightOpenIcon className="size-4" />
          </Button>
        )}
      </div>

      <MessageThread messages={messages} notes={notes} activity={activity} currentUserId={currentUserId} />
      {activeConvId && <Composer conversationId={activeConvId} />}
    </div>
  )
}
