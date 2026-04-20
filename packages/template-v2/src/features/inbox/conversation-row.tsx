import type { Contact, Conversation } from '@server/contracts/domain-types'
import { ClockIcon } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { AvatarGroup } from '@/components/ui/avatar-group'
import { RelativeTimeCard } from '@/components/ui/relative-time'
import { Status } from '@/components/ui/status'
import { cn } from '@/lib/utils'
import { deriveContactName, deriveInitials } from './lib/contact'

interface ConversationRowProps {
  conversation: Conversation
  contact?: Contact
  isSelected: boolean
  isUnread?: boolean
  onClick: () => void
}

function ConversationRow({ conversation: conv, contact, isSelected, isUnread, onClick }: ConversationRowProps) {
  const displayName = deriveContactName(contact, conv.contactId)
  const initials = deriveInitials(displayName)
  const hasAssignee = Boolean(conv.assignee && conv.assignee !== 'unassigned')
  const isBold = isSelected || !!isUnread
  const isSnoozed = Boolean(conv.snoozedUntil && new Date(conv.snoozedUntil).getTime() > Date.now())

  return (
    <div
      role="option"
      tabIndex={0}
      aria-selected={isSelected}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className={cn(
        'flex w-full cursor-default items-center gap-2 px-3 py-2 text-left transition-colors',
        'hover:bg-[var(--color-surface)]/70',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-accent)]',
        isSelected && 'bg-[var(--color-surface-elevated)]',
        isUnread && !isSelected && 'bg-[var(--color-surface)]/50',
      )}
    >
      <Avatar className="size-6 shrink-0">
        <AvatarFallback className="text-2xs">{initials}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'flex-1 truncate text-compact tracking-tight text-[var(--color-fg)]',
              isBold && 'font-medium',
            )}
          >
            {displayName}
          </span>
          {hasAssignee && (
            <AvatarGroup size={16} max={1}>
              <Avatar className="size-4">
                <AvatarFallback className="text-3xs">{conv.assignee.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </AvatarGroup>
          )}
          <Status variant={conv.status} label="" className="shrink-0" />
          {isSnoozed && conv.snoozedUntil && (
            <span
              className="flex shrink-0 items-center gap-0.5 text-mini text-[var(--color-fg-muted)]"
              data-testid="conversation-row-snoozed"
              title="Snoozed"
            >
              <ClockIcon className="size-3" />
              <RelativeTimeCard date={new Date(conv.snoozedUntil)} />
            </span>
          )}
          {!isSnoozed && conv.lastMessageAt && (
            <span className="shrink-0 text-mini text-[var(--color-fg-muted)]">
              <RelativeTimeCard date={new Date(conv.lastMessageAt)} />
            </span>
          )}
        </div>

        <p className="line-clamp-1 text-xs text-[var(--color-fg-muted)]">{conv.channelInstanceId}</p>
      </div>
    </div>
  )
}

export type { ConversationRowProps }
export { ConversationRow }
