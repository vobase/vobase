import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { AvatarGroup } from '@/components/ui/avatar-group'
import { RelativeTimeCard } from '@/components/ui/relative-time'
import { Status } from '@/components/ui/status'
import { cn } from '@/lib/utils'
import type { Conversation } from '@server/contracts/domain-types'

interface ConversationRowProps {
  conversation: Conversation
  isSelected: boolean
  isUnread?: boolean
  onClick: () => void
}

function ConversationRow({ conversation: conv, isSelected, isUnread, onClick }: ConversationRowProps) {
  const initials = conv.contactId.slice(0, 2).toUpperCase()
  const hasAssignee = Boolean(conv.assignee && conv.assignee !== 'unassigned')
  const isBold = isSelected || !!isUnread

  return (
    <button
      type="button"
      aria-selected={isSelected}
      onClick={onClick}
      className={cn(
        'flex w-full cursor-default gap-2.5 p-4 text-left transition-colors',
        'hover:bg-[var(--color-surface)]/70',
        isSelected && 'bg-[var(--color-surface-elevated)]',
        isUnread && !isSelected && 'bg-[var(--color-surface)]/50',
      )}
    >
      <Avatar className="mt-1.5 size-7 shrink-0">
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'flex-1 truncate text-[14px] tracking-tight text-[var(--color-fg)]',
              isBold && 'font-medium',
            )}
          >
            {conv.contactId}
          </span>
          <Status variant={conv.status} label="" className="shrink-0" />
          {conv.lastMessageAt && (
            <span className="shrink-0 text-[12px] tracking-tight text-[var(--color-fg-muted)]">
              <RelativeTimeCard date={new Date(conv.lastMessageAt)} />
            </span>
          )}
        </div>

        <p className="line-clamp-2 text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
          {conv.compactionSummary ?? conv.channelInstanceId}
        </p>

        {hasAssignee && (
          <div className="mt-1 flex items-center gap-1.5">
            <AvatarGroup size={20} max={3}>
              <Avatar className="size-5">
                <AvatarFallback>{conv.assignee.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </AvatarGroup>
            <span className="truncate text-[12px] text-[var(--color-fg-muted)]">{conv.assignee}</span>
          </div>
        )}
      </div>
    </button>
  )
}

export { ConversationRow }
export type { ConversationRowProps }
