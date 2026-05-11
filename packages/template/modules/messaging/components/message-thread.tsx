import type { ActivityEvent } from '@modules/messaging/hooks/use-activity'
import { Link } from '@tanstack/react-router'
import {
  BellIcon,
  BellOffIcon,
  CheckCircle2Icon,
  CheckIcon,
  ClockIcon,
  InfoIcon,
  PencilLineIcon,
  RotateCcwIcon,
  StickyNote,
  UserCogIcon,
  UserIcon,
  XIcon,
  ZapIcon,
} from 'lucide-react'
import type React from 'react'
import { Fragment, useMemo } from 'react'

import { Conversation, ConversationContent } from '@/components/ai-elements/conversation'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task'
import { DateDivider, type MessageRowKind, MessageRow as SharedMessageRow } from '@/components/message-row'
import { Principal as PrincipalNode } from '@/components/principal'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { cn } from '@/lib/utils'
import type { InternalNote, Message } from '../schema'
import { DeliveryStatus } from './delivery-status'
import { findMentions } from './mentions'
import {
  PrincipalAvatar,
  type PrincipalDirectory,
  type PrincipalKind,
  type PrincipalRecord,
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
  /** Conversation assignee (`agent:<id>` or `user:<id>`) — used to resolve agent-role messages to the right agent in multi-agent orgs. */
  assignee?: string | null
  /** Conversation contact id — used to resolve `role==='customer'` messages to the actual contact name/avatar. */
  contactId?: string | null
}

type TimelineItem =
  | { kind: 'message'; at: Date; msg: DisplayMessage }
  | { kind: 'note'; at: Date; note: InternalNote }
  | { kind: 'activity'; at: Date; ev: ActivityEvent }

export function MessageThread({
  messages,
  notes = [],
  activity = [],
  currentUserId = null,
  assignee = null,
  contactId = null,
}: MessageThreadProps) {
  const directory = usePrincipalDirectory()
  const messagesById = useMemo(() => {
    const m = new Map<string, DisplayMessage>()
    for (const msg of messages) m.set(msg.id, msg)
    return m
  }, [messages])
  const items: TimelineItem[] = [
    ...messages.map((m) => ({ kind: 'message' as const, at: new Date(m.createdAt), msg: m })),
    ...notes.map((n) => ({ kind: 'note' as const, at: new Date(n.createdAt), note: n })),
    ...activity.map((e) => ({ kind: 'activity' as const, at: new Date(e.ts), ev: e })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime())

  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="gap-3 pb-12">
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
                <MessageRow
                  msg={item.msg}
                  messagesById={messagesById}
                  directory={directory}
                  currentUserId={currentUserId}
                  assignee={assignee}
                  contactId={contactId}
                />
              )}
            </Fragment>
          )
        })}
      </ConversationContent>
    </Conversation>
  )
}

// ─── Date divider ────────────────────────────────────────────────────

// ─── Message row ─────────────────────────────────────────────────────

interface MessageRowProps {
  msg: DisplayMessage
  /** Pre-built id → message map for O(1) parent lookups on card_reply rows. */
  messagesById: Map<string, DisplayMessage>
  directory: PrincipalDirectory
  currentUserId: string | null
  /** Conversation assignee snapshot — used to identify which agent owns role==='agent' messages. */
  assignee: string | null
  /** Conversation contact id — resolves `role==='customer'` messages to the actual contact. */
  contactId: string | null
}

function messagePrincipal(
  msg: DisplayMessage,
  directory: PrincipalDirectory,
  assignee: string | null,
  contactId: string | null,
): PrincipalRecord | null {
  // Messages don't carry a sender id today. For agent rows, prefer the
  // conversation's `agent:<id>` assignee — multi-agent orgs would otherwise
  // mis-attribute every reply to the alphabetically-first agent. Fall back to
  // `directory.agents[0]` only when the assignee isn't an agent (e.g. staff
  // ownership) or the directory is still loading.
  if (msg.role === 'agent') {
    if (assignee?.startsWith('agent:')) {
      const resolved = directory.resolve(assignee)
      if (resolved) return resolved
    }
    return directory.agents[0] ?? null
  }
  if (msg.role === 'staff') return directory.staff[0] ?? null
  if (msg.role === 'customer' && contactId) return directory.resolve(`contact:${contactId}`)
  return null
}

function MessageRow({ msg, messagesById, directory, currentUserId, assignee, contactId }: MessageRowProps) {
  const principal = messagePrincipal(msg, directory, assignee, contactId)
  // "Mine" on right: the row was written by the currently-logged-in staff.
  // Messages don't track per-row senderId yet, so we treat any `role === 'staff'`
  // row as mine when a staff user is signed in.
  const isMine = Boolean(currentUserId) && msg.role === 'staff'
  const kind: MessageRowKind = msg.role === 'customer' ? 'customer' : (principal?.kind ?? 'staff')

  const taskPayload = isTaskPayload(msg.content) ? msg.content : null
  const parent = msg.parentMessageId ? messagesById.get(msg.parentMessageId) : undefined
  const failureReason =
    typeof msg.content === 'object' && msg.content !== null
      ? (msg.content as { failureReason?: unknown }).failureReason
      : undefined

  const authorLabel = principal ? (
    <PrincipalNode id={principal.token} variant="simple" className="text-foreground/80" />
  ) : null

  const bubbleHeader = msg.reasoning ? (
    <Reasoning defaultOpen={false}>
      <ReasoningTrigger />
      <ReasoningContent>{msg.reasoning}</ReasoningContent>
    </Reasoning>
  ) : null

  const bodyOverride = taskPayload ? (
    <Task>
      <TaskTrigger title={taskPayload.title} />
      <TaskContent>
        {taskPayload.items.map((task) => (
          <TaskItem key={task.id}>{task.label}</TaskItem>
        ))}
      </TaskContent>
    </Task>
  ) : undefined

  return (
    <SharedMessageRow
      msg={msg}
      parent={parent}
      authorKind={kind}
      authorLabel={authorLabel}
      isMine={isMine}
      scope="staff"
      trailingHeader={
        <DeliveryStatus status={msg.status} failureReason={typeof failureReason === 'string' ? failureReason : null} />
      }
      bubbleHeader={bubbleHeader}
      bodyOverride={bodyOverride}
    />
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
      <div className="mb-1 flex items-center gap-1 font-semibold text-[10px] text-amber-700 uppercase tracking-wide dark:text-amber-300">
        <StickyNote className="size-2.5" />
        Internal note
      </div>
      <div className="whitespace-pre-wrap break-words text-foreground text-sm">
        {renderNoteBodyWithMentions(note.body, note.mentions, directory, currentUserId)}
      </div>
      {isMentioned ? (
        <div className="mt-1 font-medium text-rose-600 text-xs uppercase tracking-wide dark:text-rose-400">
          You were mentioned
        </div>
      ) : null}
    </Bubble>
  )
}

function renderNoteBodyWithMentions(
  body: string,
  mentions: readonly string[],
  directory: PrincipalDirectory,
  currentUserId: string | null,
): React.ReactNode[] {
  if (mentions.length === 0) return [body]
  const records = mentions.map((m) => directory.resolve(m)).filter((r): r is PrincipalRecord => r !== null)
  const matches = findMentions(body, records)
  if (matches.length === 0) return [body]

  const out: React.ReactNode[] = []
  let cursor = 0
  for (const m of matches) {
    if (m.start > cursor) out.push(body.slice(cursor, m.start))
    const isMe = currentUserId !== null && m.record.token === `staff:${currentUserId}`
    out.push(
      <PrincipalNode
        key={`mention-${m.start}`}
        id={m.record.token}
        variant="mention"
        highlight={isMe}
        directory={directory}
      />,
    )
    cursor = m.end
  }
  if (cursor < body.length) out.push(body.slice(cursor))
  return out
}

// ─── Shared bubble ───────────────────────────────────────────────────

const BUBBLE_BG: Record<'customer' | PrincipalKind, string> = {
  customer: 'bg-muted/60 text-foreground',
  agent: 'bg-violet-100/70 text-foreground dark:bg-violet-950/40',
  staff: 'bg-blue-100/70 text-foreground dark:bg-blue-950/40',
  contact: 'bg-emerald-100/70 text-foreground dark:bg-emerald-950/40',
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
  principal: PrincipalRecord | null
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
  const fallbackName =
    kind === 'customer' ? 'Customer' : kind === 'agent' ? 'Agent' : kind === 'contact' ? 'Contact' : 'Staff'

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
          {principal ? (
            <PrincipalNode id={principal.token} variant="simple" className="text-foreground/80" />
          ) : (
            <span className="font-medium text-foreground/80">{fallbackName}</span>
          )}
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
      <PrincipalNode id={p.token} variant="simple" directory={directory} />
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
    case 'change.proposed':
      return (
        <ChangeActivityLine
          icon={<ClockIcon className="size-3.5 text-amber-600" />}
          payload={p}
          directory={directory}
          fallbackText="Change proposed"
          actor={{ tokenKey: 'proposedBy', verb: 'proposed', defaultKind: 'agent' }}
        />
      )
    case 'change.auto_applied':
      return (
        <ChangeActivityLine
          icon={<PencilLineIcon className="size-3.5" />}
          payload={p}
          directory={directory}
          fallbackText="Change applied"
          actor={{ tokenKey: 'proposedBy', verb: 'auto-applied', defaultKind: 'agent' }}
        />
      )
    case 'change.approved':
      return (
        <ChangeActivityLine
          icon={<CheckIcon className="size-3.5 text-emerald-600" />}
          payload={p}
          directory={directory}
          fallbackText="Change approved"
          actor={{ tokenKey: 'decidedBy', verb: 'approved', defaultKind: 'staff' }}
        />
      )
    case 'change.rejected':
      return (
        <ChangeActivityLine
          icon={<XIcon className="size-3.5 text-rose-600" />}
          payload={p}
          directory={directory}
          fallbackText="Change declined"
          actor={{ tokenKey: 'decidedBy', verb: 'declined', defaultKind: 'staff' }}
        />
      )
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

const SYSTEM_REJECTION_REASONS = new Set(['staff_rejected', 'threat_scan'])

/**
 * Inline timeline row for `change.*` lifecycle events. Shape:
 *   `[icon] <Principal> <verb>: <headline>  (i)`
 * Where:
 *  - Principal renders the actor (`proposedBy` for proposed/auto-applied,
 *    `decidedBy` for approved/declined) so timelines tell you *who* did it,
 *    not just what changed.
 *  - The headline is the short `summary` (falls back to `rationale`, then
 *    the fallback text) and the line links to `/changes?id=<proposalId>`
 *    so staff can jump to the diff + approve/reject UI.
 *  - The `(i)` info icon at the end of the row reveals the longer
 *    `rationale` and any staff-authored `decidedNote` in a tooltip — small
 *    explicit affordance instead of the previous full-line hover trigger.
 */
function ChangeActivityLine({
  icon,
  payload,
  directory,
  fallbackText,
  actor,
}: {
  icon: React.ReactNode
  payload: Record<string, unknown>
  directory: PrincipalDirectory
  fallbackText: string
  actor: {
    tokenKey: 'proposedBy' | 'decidedBy'
    verb: 'proposed' | 'auto-applied' | 'approved' | 'declined'
    defaultKind: PrincipalKind
  }
}) {
  const summary = typeof payload.summary === 'string' && payload.summary.trim() ? payload.summary : null
  const rationale = typeof payload.rationale === 'string' && payload.rationale.trim() ? payload.rationale : null
  const proposalId = typeof payload.proposalId === 'string' && payload.proposalId.length > 0 ? payload.proposalId : null
  const decidedNoteRaw =
    typeof payload.decidedNote === 'string' && payload.decidedNote.trim() ? payload.decidedNote : null
  // System-emitted rejection reasons (`staff_rejected`, `threat_scan`) are
  // tokens, not staff-authored prose — suppress so the hover card stays clean.
  const decidedNote = decidedNoteRaw && !SYSTEM_REJECTION_REASONS.has(decidedNoteRaw) ? decidedNoteRaw : null

  // `decidedBy` historically lands as a bare userId (no `staff:` prefix); coerce
  // to canonical form so the directory can resolve avatar + display name.
  const actorRaw = payload[actor.tokenKey]
  const actorToken =
    typeof actorRaw === 'string' && actorRaw.length > 0
      ? actorRaw.includes(':')
        ? actorRaw
        : `${actor.defaultKind}:${actorRaw}`
      : null

  const headline = summary ?? rationale ?? fallbackText
  const hasHoverDetail = (rationale && rationale !== headline) || decidedNote

  const linkInner = (
    <span className="inline-flex items-center gap-1">
      {icon}
      {actorToken ? <PrincipalInline value={actorToken} directory={directory} fallback={actor.defaultKind} /> : null}
      <span>{actor.verb}:</span>
      <span className="truncate">{headline}</span>
    </span>
  )

  const linked = proposalId ? (
    <Link to="/changes" search={{ id: proposalId }} className="inline-flex items-center hover:text-foreground">
      {linkInner}
    </Link>
  ) : (
    linkInner
  )

  return (
    <div className="flex justify-center px-2">
      <div className="inline-flex max-w-[36rem] items-center gap-1.5 text-muted-foreground text-xs">
        {linked}
        {hasHoverDetail ? (
          <HoverCard openDelay={150} closeDelay={75}>
            <HoverCardTrigger asChild>
              <button
                type="button"
                aria-label="Show change details"
                className="inline-flex items-center text-muted-foreground/60 hover:text-foreground"
              >
                <InfoIcon className="size-3.5" />
              </button>
            </HoverCardTrigger>
            <HoverCardContent side="top" align="center" className="w-80 space-y-2 text-xs leading-relaxed">
              {rationale && rationale !== headline ? <p className="text-foreground">{rationale}</p> : null}
              {decidedNote ? (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Decision note:</span> {decidedNote}
                </p>
              ) : null}
            </HoverCardContent>
          </HoverCard>
        ) : null}
      </div>
    </div>
  )
}
