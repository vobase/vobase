import type { Contact } from '@modules/contacts/schema'
import { deriveContactName } from '@modules/messaging/components/contact'
import { AtSignIcon, ClockIcon } from 'lucide-react'

import { Principal } from '@/components/principal'
import { PrincipalAvatar } from '@/components/principal/avatar'
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
  return conv.lastMessagePreview ?? null
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
        'group flex w-full cursor-default items-start gap-3 px-4 py-3 text-left transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-2px]',
        isSelected ? 'bg-foreground-5' : 'hover:bg-foreground-3',
      )}
    >
      <PrincipalAvatar kind="contact" size="lg" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Principal
            id={`contact:${conv.contactId}`}
            variant="simple"
            fallbackName={displayName}
            noHover
            className={cn(
              'flex-1 truncate text-foreground text-sm tracking-tight',
              isBold ? 'font-medium' : 'font-normal',
            )}
          />
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
              className="flex shrink-0 items-center gap-1 whitespace-nowrap text-foreground-50 text-xs"
              data-testid="conversation-row-snoozed"
              title="Snoozed"
            >
              <ClockIcon className="size-3" />
              <RelativeTimeCard date={new Date(conv.snoozedUntil)} length="short" />
            </span>
          ) : conv.lastMessageAt ? (
            <span className="shrink-0 whitespace-nowrap text-foreground-50 text-xs">
              <RelativeTimeCard date={new Date(conv.lastMessageAt)} length="short" />
            </span>
          ) : null}
        </div>

        <p className="mt-0.5 truncate text-foreground-50 text-xs">
          {preview ? (
            <>
              {prefix && <span className="text-foreground-40">{prefix}</span>}
              {preview}
            </>
          ) : (
            ' '
          )}
        </p>
      </div>
    </div>
  )
}

export type { ConversationRowProps }
export { ConversationRow }
