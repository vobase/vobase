import type { Contact } from '@modules/contacts/schema'
import { deriveContactName } from '@modules/messaging/components/contact'
import { AtSignIcon, ClockIcon } from 'lucide-react'

import { RelativeTimeCard } from '@/components/ui/relative-time'
import { cn } from '@/lib/utils'
import type { Conversation } from '../schema'

interface ConversationRowProps {
  conversation: Conversation
  contact?: Contact
  isSelected: boolean
  isUnread?: boolean
  /** Current staff user has one or more unread @-mentions in this conversation. */
  hasUnreadMention?: boolean
  onClick: () => void
}

function derivePreview(conv: Conversation): string | null {
  if (conv.lastMessageKind === 'image') return '[image]'
  if (conv.lastMessageKind === 'card') return conv.lastMessagePreview ?? '[card]'
  if (conv.lastMessageKind === 'card_reply') return conv.lastMessagePreview ?? '[reply]'
  const text = conv.lastMessagePreview
  if (!text) return null
  return text.length > 120 ? `${text.slice(0, 117)}…` : text
}

function previewPrefix(conv: Conversation): string {
  if (conv.lastMessageRole === 'agent') return 'Agent: '
  if (conv.lastMessageRole === 'staff') return 'You: '
  return ''
}

function ConversationRow({
  conversation: conv,
  contact,
  isSelected,
  isUnread,
  hasUnreadMention,
  onClick,
}: ConversationRowProps) {
  const displayName = deriveContactName(contact, conv.contactId)
  const isBold = isSelected || !!isUnread
  const isSnoozed = Boolean(conv.snoozedUntil && new Date(conv.snoozedUntil).getTime() > Date.now())
  const preview = derivePreview(conv)
  const prefix = preview ? previewPrefix(conv) : ''

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
        'group flex w-full cursor-default items-start gap-2 border-l-2 px-3 py-2 text-left transition-colors',
        'hover:bg-[var(--color-surface)]/70',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-[-2px]',
        isSelected ? 'border-primary bg-primary/10' : 'border-transparent',
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'flex-1 truncate text-[var(--color-fg)] text-sm tracking-tight',
              isBold ? 'font-medium' : 'font-normal',
            )}
          >
            {displayName}
          </span>
          {hasUnreadMention ? (
            <span
              role="img"
              className="flex shrink-0 items-center justify-center rounded-full bg-rose-600 p-0.5 text-white dark:bg-rose-500"
              aria-label="You have an unread mention in this conversation"
              title="You have an unread mention"
              data-testid="conversation-row-unread-mention"
            >
              <AtSignIcon className="size-3" strokeWidth={3} />
            </span>
          ) : null}
          {isSnoozed && conv.snoozedUntil ? (
            <span
              className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[var(--color-fg-muted)] text-mini"
              data-testid="conversation-row-snoozed"
              title="Snoozed"
            >
              <ClockIcon className="size-3" />
              <RelativeTimeCard date={new Date(conv.snoozedUntil)} length="short" />
            </span>
          ) : conv.lastMessageAt ? (
            <span className="shrink-0 whitespace-nowrap text-[var(--color-fg-muted)] text-mini">
              <RelativeTimeCard date={new Date(conv.lastMessageAt)} length="short" />
            </span>
          ) : null}
        </div>

        <p className="truncate text-[var(--color-fg-muted)] text-xs">
          {preview ? (
            <>
              {prefix && <span className="text-[var(--color-fg-muted)]/70">{prefix}</span>}
              {preview}
            </>
          ) : (
            ' '
          )}
        </p>
      </div>
    </div>
  )
}

export type { ConversationRowProps }
export { ConversationRow }
