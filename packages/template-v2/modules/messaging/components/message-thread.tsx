import type { ActivityEvent } from '@modules/messaging/hooks/use-activity'
import {
  BellIcon,
  BellOffIcon,
  CheckCircle2Icon,
  RotateCcwIcon,
  StickyNote,
  UserCogIcon,
  UserIcon,
  ZapIcon,
} from 'lucide-react'
import type React from 'react'
import { Fragment } from 'react'

import { Conversation, ConversationContent } from '@/components/ai-elements/conversation'
import { MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task'
import { MessageCard } from '@/components/message-card'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { cn } from '@/lib/utils'
import type { InternalNote, Message } from '../schema'
import { DeliveryStatus } from './delivery-status'
import {
  type Principal,
  PrincipalAvatar,
  type PrincipalDirectory,
  type PrincipalKind,
  usePrincipalDirectory,
} from './principal'

export type DisplayMessage = Message & { reasoning?: string | null }

interface TaskPayload {
  type: 'task'
  title: string
  items: Array<{ id: string; label: string }>
}

function isTaskPayload(content: unknown): content is TaskPayload {
  if (typeof content !== 'object' || content === null) return false
  const c = content as Record<string, unknown>
  return c.type === 'task' && typeof c.title === 'string' && Array.isArray(c.items)
}

interface MessageThreadProps {
  messages: DisplayMessage[]
  notes?: InternalNote[]
  activity?: ActivityEvent[]
  currentUserId?: string | null
}

type TimelineItem =
  | { kind: 'message'; at: Date; msg: DisplayMessage }
  | { kind: 'note'; at: Date; note: InternalNote }
  | { kind: 'activity'; at: Date; ev: ActivityEvent }

export function MessageThread({ messages, notes = [], activity = [], currentUserId = null }: MessageThreadProps) {
  const directory = usePrincipalDirectory()
  const items: TimelineItem[] = [
    ...messages.map((m) => ({ kind: 'message' as const, at: new Date(m.createdAt), msg: m })),
    ...notes.map((n) => ({ kind: 'note' as const, at: new Date(n.createdAt), note: n })),
    ...activity.map((e) => ({ kind: 'activity' as const, at: new Date(e.ts), ev: e })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime())

  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="gap-3">
        {items.map((item, idx) => {
          const prev = idx > 0 ? items[idx - 1] : null
          const showDivider = !prev || prev.at.toDateString() !== item.at.toDateString()
          const key =
            item.kind === 'message'
              ? `msg-${item.msg.id}`
              : item.kind === 'note'
                ? `note-${item.note.id}`
                : `act-${item.ev.id}`
          return (
            <Fragment key={key}>
              {showDivider && <DateDivider at={item.at} />}
              {item.kind === 'activity' && <ActivityRow ev={item.ev} directory={directory} />}
              {item.kind === 'note' && <NoteRow note={item.note} directory={directory} currentUserId={currentUserId} />}
              {item.kind === 'message' && (
                <MessageRow msg={item.msg} messages={messages} directory={directory} currentUserId={currentUserId} />
              )}
            </Fragment>
          )
        })}
      </ConversationContent>
    </Conversation>
  )
}

// ─── Date divider ────────────────────────────────────────────────────

const DATE_DIVIDER_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

function DateDivider({ at }: { at: Date }) {
  const label = DATE_DIVIDER_FMT.format(at)
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 border-t" />
      <span className="font-medium text-muted-foreground/60 text-xs uppercase tracking-wide">{label}</span>
      <div className="flex-1 border-t" />
    </div>
  )
}

// ─── Message row ─────────────────────────────────────────────────────

interface MessageRowProps {
  msg: DisplayMessage
  messages: DisplayMessage[]
  directory: PrincipalDirectory
  currentUserId: string | null
}

function messagePrincipal(msg: DisplayMessage, directory: PrincipalDirectory): Principal | null {
  // Messages don't carry a sender id today; resolve by role.
  if (msg.role === 'customer') return null
  if (msg.role === 'agent') {
    // Pick the first known agent, or a generic fallback.
    const a = directory.agents[0]
    return a ? { kind: 'agent', id: a.id, name: a.name } : { kind: 'agent', id: 'agent', name: 'Agent' }
  }
  if (msg.role === 'staff') {
    const s = directory.staff[0]
    return s ? { kind: 'staff', id: s.id, name: s.name } : { kind: 'staff', id: 'staff', name: 'Staff' }
  }
  return null
}

function MessageRow({ msg, messages, directory, currentUserId }: MessageRowProps) {
  const principal = messagePrincipal(msg, directory)
  // "Mine" on right: the row was written by the currently-logged-in staff.
  // Messages don't track per-row senderId yet, so we treat any `role === 'staff'`
  // row as mine when a staff user is signed in.
  const isMine = Boolean(currentUserId) && msg.role === 'staff'
  const kind: PrincipalKind | 'customer' = msg.role === 'customer' ? 'customer' : (principal?.kind ?? 'staff')

  const taskPayload = isTaskPayload(msg.content) ? msg.content : null
  const parent = msg.kind === 'card_reply' ? messages.find((m) => m.id === msg.parentMessageId) : undefined
  const failureReason =
    typeof msg.content === 'object' && msg.content !== null
      ? (msg.content as { failureReason?: unknown }).failureReason
      : undefined

  return (
    <Bubble
      isMine={isMine}
      principal={principal}
      kind={kind}
      timestamp={msg.createdAt}
      status={msg.status}
      failureReason={typeof failureReason === 'string' ? failureReason : null}
    >
      {msg.reasoning && (
        <Reasoning defaultOpen={false}>
          <ReasoningTrigger />
          <ReasoningContent>{msg.reasoning}</ReasoningContent>
        </Reasoning>
      )}
      {taskPayload ? (
        <Task>
          <TaskTrigger title={taskPayload.title} />
          <TaskContent>
            {taskPayload.items.map((task) => (
              <TaskItem key={task.id}>{task.label}</TaskItem>
            ))}
          </TaskContent>
        </Task>
      ) : msg.kind === 'text' ? (
        <MessageResponse>{String((msg.content as { text?: unknown })?.text ?? '')}</MessageResponse>
      ) : (
        <MessageCard message={msg} parentMessage={parent} />
      )}
    </Bubble>
  )
}

// ─── Note row ────────────────────────────────────────────────────────

function NoteRow({
  note,
  directory,
  currentUserId,
}: {
  note: InternalNote
  directory: PrincipalDirectory
  currentUserId: string | null
}) {
  const principal = directory.resolve(note.authorType === 'agent' ? `agent:${note.authorId}` : note.authorId)
  const isMine = Boolean(currentUserId) && note.authorType === 'staff' && note.authorId === currentUserId
  const kind: PrincipalKind = principal?.kind ?? (note.authorType === 'agent' ? 'agent' : 'staff')
  const isMentioned = Boolean(currentUserId) && note.mentions.some((m) => m === `staff:${currentUserId}`)

  return (
    <Bubble isMine={isMine} principal={principal} kind={kind} variant="note" timestamp={note.createdAt}>
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-700 text-xs uppercase tracking-wide dark:text-amber-300">
        <StickyNote className="size-3" />
        Internal note
      </div>
      <div className="whitespace-pre-wrap break-words text-foreground text-sm">
        {renderNoteBodyWithMentions(note.body, note.mentions, directory, currentUserId)}
      </div>
      {isMentioned ? (
        <div className="mt-1 font-medium text-mini text-rose-600 uppercase tracking-wide dark:text-rose-400">
          You were mentioned
        </div>
      ) : null}
    </Bubble>
  )
}

/**
 * Render a note body with `@Name` tokens highlighted. Only tokens whose
 * display name matches an entry in `note.mentions` get styled — random `@foo`
 * tokens fall through as plain text.
 */
function renderNoteBodyWithMentions(
  body: string,
  mentions: readonly string[],
  directory: PrincipalDirectory,
  currentUserId: string | null,
): React.ReactNode[] {
  if (mentions.length === 0) return [body]

  const nameToKey = new Map<string, string>()
  for (const m of mentions) {
    const principal = directory.resolve(m.startsWith('staff:') ? m.slice('staff:'.length) : m)
    const name = principal?.name
    if (name) nameToKey.set(name.toLowerCase(), m)
  }
  if (nameToKey.size === 0) return [body]

  const out: React.ReactNode[] = []
  const matches = Array.from(body.matchAll(/@([A-Za-z][A-Za-z0-9._-]*(?:\s+[A-Za-z][A-Za-z0-9._-]*)?)/g))
  let cursor = 0
  let chipIdx = 0
  for (const m of matches) {
    const raw = m[0]
    const name = m[1]
    const idx = m.index ?? -1
    if (idx < 0) continue
    const key = nameToKey.get(name.toLowerCase())
    if (!key) continue
    if (idx > cursor) out.push(body.slice(cursor, idx))
    const isMe = currentUserId !== null && key === `staff:${currentUserId}`
    out.push(
      <span
        key={`mention-${chipIdx++}`}
        className={cn(
          'rounded px-1 font-semibold',
          isMe
            ? 'bg-rose-600 text-white ring-1 ring-rose-700 dark:bg-rose-500 dark:ring-rose-300'
            : 'bg-blue-600 text-white ring-1 ring-blue-700 dark:bg-blue-500 dark:ring-blue-300',
        )}
      >
        {raw}
      </span>,
    )
    cursor = idx + raw.length
  }
  if (cursor < body.length) out.push(body.slice(cursor))
  return out
}

// ─── Shared bubble ───────────────────────────────────────────────────

const BUBBLE_BG: Record<'customer' | PrincipalKind, string> = {
  customer: 'bg-muted/60 text-foreground',
  agent: 'bg-violet-100/70 text-foreground dark:bg-violet-950/40',
  staff: 'bg-blue-100/70 text-foreground dark:bg-blue-950/40',
}

function Bubble({
  isMine,
  principal,
  kind,
  variant = 'message',
  timestamp,
  status = null,
  failureReason = null,
  children,
}: {
  isMine: boolean
  principal: Principal | null
  kind: 'customer' | PrincipalKind
  variant?: 'message' | 'note'
  timestamp?: Date | string | number
  status?: string | null
  failureReason?: string | null
  children: React.ReactNode
}) {
  const isFailed = status === 'failed'
  const bubbleClass =
    variant === 'note'
      ? 'rounded-lg border border-amber-500/30 bg-amber-50/70 px-3 py-2 dark:bg-amber-950/25'
      : cn('rounded-lg px-3 py-2', isFailed ? 'border border-destructive/30 bg-destructive/5' : BUBBLE_BG[kind])
  const name = principal?.name ?? (kind === 'customer' ? 'Customer' : kind === 'agent' ? 'Agent' : 'Staff')

  return (
    <div className={cn('flex gap-2', isMine ? 'flex-row-reverse' : 'flex-row')}>
      <div className="shrink-0 pt-5">
        {principal ? (
          <PrincipalAvatar kind={principal.kind} size="md" />
        ) : (
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserIcon className="size-3.5" />
          </span>
        )}
      </div>
      <div className={cn('flex min-w-0 max-w-[min(78%,560px)] flex-col gap-1', isMine ? 'items-end' : 'items-start')}>
        <div className={cn('flex items-center gap-1.5 text-muted-foreground text-xs', isMine && 'flex-row-reverse')}>
          <span className="font-medium text-foreground/80">{name}</span>
          {timestamp && (
            <RelativeTimeCard
              date={timestamp}
              length="short"
              className="text-muted-foreground text-xs hover:text-foreground"
            />
          )}
          <DeliveryStatus status={status} failureReason={failureReason} />
        </div>
        <div className={cn(bubbleClass, 'min-w-0 text-sm')}>{children}</div>
      </div>
    </div>
  )
}

// ─── Activity row ────────────────────────────────────────────────────

const UNTIL_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatUntil(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return UNTIL_FMT.format(d)
}

function PrincipalInline({
  value,
  directory,
  fallback,
}: {
  value: unknown
  directory: PrincipalDirectory
  fallback: string
}) {
  const p = typeof value === 'string' ? directory.resolve(value) : null
  if (!p) return <span className="font-medium">{fallback}</span>
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <PrincipalAvatar kind={p.kind} />
      <span className="font-medium">{p.name}</span>
    </span>
  )
}

function ActivityRow({ ev, directory }: { ev: ActivityEvent; directory: PrincipalDirectory }) {
  const p = ev.payload
  switch (ev.type) {
    case 'conversation.reassigned': {
      const from = typeof p.from === 'string' ? directory.resolve(p.from) : null
      return (
        <ActivityLine icon={<UserCogIcon className="size-3.5" />}>
          {from ? (
            <>
              Reassigned from <PrincipalInline value={p.from} directory={directory} fallback="unknown" /> to{' '}
              <PrincipalInline value={p.to} directory={directory} fallback="unassigned" />
            </>
          ) : (
            <>
              Assigned to <PrincipalInline value={p.to} directory={directory} fallback="unassigned" />
            </>
          )}
        </ActivityLine>
      )
    }
    case 'conversation.resolved':
      return (
        <ActivityLine icon={<CheckCircle2Icon className="size-3.5 text-emerald-600" />}>
          {typeof p.reason === 'string' && p.reason ? `Resolved — ${p.reason}` : 'Resolved'}
        </ActivityLine>
      )
    case 'conversation.reopened':
      return (
        <ActivityLine icon={<RotateCcwIcon className="size-3.5" />}>
          {p.trigger === 'new_inbound' ? 'Reopened by new inbound message' : 'Reopened'}
        </ActivityLine>
      )
    case 'conversation.snoozed': {
      const until = formatUntil(p.until)
      return (
        <ActivityLine icon={<BellOffIcon className="size-3.5" />}>
          {until ? `Snoozed until ${until}` : 'Snoozed'}
        </ActivityLine>
      )
    }
    case 'conversation.unsnoozed':
      return <ActivityLine icon={<BellIcon className="size-3.5" />}>Unsnoozed</ActivityLine>
    case 'conversation.snooze_expired':
      return <ActivityLine icon={<BellIcon className="size-3.5" />}>Snooze expired</ActivityLine>
    default:
      return <ActivityLine icon={<ZapIcon className="size-3.5" />}>{ev.type}</ActivityLine>
  }
}

function ActivityLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex justify-center px-2">
      <div className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
        {icon}
        <span className="inline-flex items-center gap-1">{children}</span>
      </div>
    </div>
  )
}
