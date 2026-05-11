/**
 * Shared chat-message row used by both the staff inbox timeline and the
 * customer-facing public web chat.
 *
 * Scope split:
 * - `staff` — caller supplies a `<Principal />`-rendered `authorLabel`
 *   (hover card with full identity), `trailingHeader` for delivery-status
 *   badges, and may inject `bubbleHeader` / `bodyOverride` for staff-only
 *   ai-elements (Reasoning, Task).
 * - `public` — caller supplies a plain-text `authorLabel` so the public
 *   chat doesn't need the staff principal directory (which fans out to
 *   `useStaffList` + `useContactsList`, both staff-only endpoints).
 *
 * Public-scope cards remain interactive (`readOnly={false}`) so the customer
 * can tap quick actions; staff-scope cards render disabled audit views.
 */

import type { Message } from '@modules/messaging/schema'
import { UserIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { MessageResponse } from '@/components/ai-elements/message'
import { MessageCard } from '@/components/message-card'
import { PrincipalAvatar, type PrincipalKind } from '@/components/principal'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import { cn } from '@/lib/utils'

export type MessageRowKind = 'customer' | PrincipalKind

const BUBBLE_BG: Record<MessageRowKind, string> = {
  customer: 'bg-muted/60 text-foreground',
  agent: 'bg-violet-100/70 text-foreground dark:bg-violet-950/40',
  staff: 'bg-blue-100/70 text-foreground dark:bg-blue-950/40',
  contact: 'bg-emerald-100/70 text-foreground dark:bg-emerald-950/40',
}

const KIND_FALLBACK: Record<MessageRowKind, string> = {
  customer: 'Customer',
  agent: 'Agent',
  staff: 'Staff',
  contact: 'Contact',
}

export interface MessageRowProps {
  msg: Message
  /** Parent message — required for `card_reply` rows that quote the original card. */
  parent?: Message
  /**
   * Visual kind. Drives bubble background + avatar color. Pass `null` when no
   * author is resolvable (rare — shows a generic person icon).
   */
  authorKind: MessageRowKind | null
  /**
   * Pre-rendered author label. Staff inbox passes `<Principal id=... />`
   * (hover-cardable); public chat passes a plain text node.
   */
  authorLabel: ReactNode
  /** Right-aligns the row. Staff inbox sets this for the signed-in user's rows; public chat sets it for customer-role rows. */
  isMine: boolean
  /** Public scope hides delivery-status badges and keeps card actions interactive. */
  scope?: 'public' | 'staff'
  /** Optimistic outgoing row — dimmed while awaiting server echo. */
  optimistic?: boolean
  /** Customer widget callback for card-button taps. */
  onCardOptimisticReply?: (btn: { buttonId: string; buttonValue: string; buttonLabel: string }) => void
  /** Staff-only slot rendered next to the timestamp (e.g. delivery status). */
  trailingHeader?: ReactNode
  /** Staff-only slot inside the bubble, above the body (e.g. agent reasoning). */
  bubbleHeader?: ReactNode
  /** Override the bubble body — staff inbox uses this for structured task payloads. */
  bodyOverride?: ReactNode
}

export function MessageRow({
  msg,
  parent,
  authorKind,
  authorLabel,
  isMine,
  scope = 'staff',
  optimistic,
  onCardOptimisticReply,
  trailingHeader,
  bubbleHeader,
  bodyOverride,
}: MessageRowProps) {
  const kind: MessageRowKind = authorKind ?? (msg.role === 'customer' ? 'customer' : 'staff')
  // Avatars don't have a 'customer' color — the row's customer kind maps to a
  // contact-green badge (matches the inbox convention where contact = green).
  const avatarKind: PrincipalKind = kind === 'customer' ? 'contact' : kind
  const isFailed = msg.status === 'failed'
  const bubbleClass = cn(
    'min-w-0 rounded-lg px-3 py-2 text-sm',
    isFailed ? 'border border-destructive/30 bg-destructive/5' : BUBBLE_BG[kind],
  )
  const fallbackLabel = <span className="font-medium text-foreground/80">{KIND_FALLBACK[kind]}</span>

  return (
    <div className={cn('flex gap-2', isMine ? 'flex-row-reverse' : 'flex-row', optimistic && 'opacity-60')}>
      <div className="shrink-0 pt-5">
        {authorKind ? (
          <PrincipalAvatar kind={avatarKind} size="md" />
        ) : (
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserIcon className="size-3.5" />
          </span>
        )}
      </div>
      <div className={cn('flex min-w-0 max-w-[min(78%,560px)] flex-col gap-1', isMine ? 'items-end' : 'items-start')}>
        <div className={cn('flex items-center gap-1.5 text-muted-foreground text-xs', isMine && 'flex-row-reverse')}>
          {authorLabel || fallbackLabel}
          {msg.createdAt && (
            <RelativeTimeCard
              date={msg.createdAt}
              length="short"
              className="text-muted-foreground text-xs hover:text-foreground"
            />
          )}
          {scope === 'staff' && trailingHeader}
        </div>
        <div className={bubbleClass}>
          {bubbleHeader}
          {bodyOverride ?? defaultBody(msg, parent, scope, onCardOptimisticReply)}
        </div>
      </div>
    </div>
  )
}

function defaultBody(
  msg: Message,
  parent: Message | undefined,
  scope: 'public' | 'staff',
  onCardOptimisticReply: ((btn: { buttonId: string; buttonValue: string; buttonLabel: string }) => void) | undefined,
): ReactNode {
  if (msg.kind === 'text') {
    return <MessageResponse>{String((msg.content as { text?: unknown })?.text ?? '')}</MessageResponse>
  }
  return (
    <MessageCard
      message={msg}
      parentMessage={parent}
      readOnly={scope === 'staff'}
      onOptimisticReply={onCardOptimisticReply}
    />
  )
}

// ─── Date divider ───────────────────────────────────────────────────────────

const DATE_DIVIDER_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

export function DateDivider({ at }: { at: Date }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 border-t" />
      <span className="font-medium text-muted-foreground/60 text-xs uppercase tracking-wide">
        {DATE_DIVIDER_FMT.format(at)}
      </span>
      <div className="flex-1 border-t" />
    </div>
  )
}
