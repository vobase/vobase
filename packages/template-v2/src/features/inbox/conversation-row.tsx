import type { Conversation } from '@server/contracts/domain-types'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { AvatarGroup } from '@/components/ui/avatar-group'
import { RelativeTimeCard } from '@/components/ui/relative-time'
import { Status } from '@/components/ui/status'
import { cn } from '@/lib/utils'

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
      role="option"
      aria-selected={isSelected}
      onClick={onClick}
      className={cn(
        'flex w-full cursor-default items-center gap-2 px-3 py-2 text-left transition-colors',
        'hover:bg-[var(--color-surface)]/70',
        isSelected && 'bg-[var(--color-surface-elevated)]',
        isUnread && !isSelected && 'bg-[var(--color-surface)]/50',
      )}
    >
      <Avatar className="size-6 shrink-0">
        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn('flex-1 truncate text-[13px] tracking-tight text-[var(--color-fg)]', isBold && 'font-medium')}
          >
            {conv.contactId}
          </span>
          {hasAssignee && (
            <AvatarGroup size={16} max={1}>
              <Avatar className="size-4">
                <AvatarFallback className="text-[9px]">{conv.assignee.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </AvatarGroup>
          )}
          <Status variant={conv.status} label="" className="shrink-0" />
          {conv.lastMessageAt && (
            <span className="shrink-0 text-[11px] text-[var(--color-fg-muted)]">
              <RelativeTimeCard date={new Date(conv.lastMessageAt)} />
            </span>
          )}
        </div>

        <p className="line-clamp-1 text-[12px] text-[var(--color-fg-muted)]">
          {conv.compactionSummary ?? conv.channelInstanceId}
        </p>
      </div>
    </button>
  )
}

export type { ConversationRowProps }
export { ConversationRow }
