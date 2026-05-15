import type { Message } from '@modules/messaging/schema'

import { cn } from '@/lib/utils'
import type { ButtonElement, LinkButtonElement } from './card-actions'
import { CardActions } from './card-actions'
import { CardFields } from './card-fields'

interface TextElement {
  type: 'text'
  style?: 'plain' | 'bold' | 'muted'
  content: string
}

interface ImageElement {
  type: 'image'
  url?: string
  alt?: string
}

interface DividerElement {
  type: 'divider'
}

interface FieldChild {
  type: 'field'
  label: string
  value: string
}

interface FieldsElement {
  type: 'fields'
  children: FieldChild[]
}

interface ActionsElement {
  type: 'actions'
  children: Array<ButtonElement | LinkButtonElement>
}

interface LinkElement {
  type: 'link'
  label: string
  url: string
}

type CardChild = TextElement | ImageElement | DividerElement | FieldsElement | ActionsElement | LinkElement

interface CardElement {
  type?: 'card'
  title?: string
  children?: CardChild[]
}

interface TextContent {
  text?: string
}

interface CardContent {
  card?: CardElement
}

interface ImageContent {
  driveFileId?: string
  url?: string
  type?: 'image' | 'document' | 'video' | 'audio'
  caption?: string
}

interface CardReplyContent {
  buttonId?: string
  buttonValue?: string
  buttonLabel?: string
}

function CardChildNode({
  child,
  messageId,
  conversationId,
  readOnly,
  onOptimisticReply,
}: {
  child: CardChild
  messageId: string
  conversationId: string
  readOnly?: boolean
  onOptimisticReply?: (btn: { buttonId: string; buttonValue: string; buttonLabel: string }) => void
}) {
  switch (child.type) {
    case 'text':
      return (
        <p
          className={cn('break-words text-foreground', {
            'font-semibold text-sm': child.style === 'bold',
            'text-sm': child.style === 'plain' || !child.style,
            'text-muted-foreground text-xs': child.style === 'muted',
          })}
        >
          {child.content}
        </p>
      )

    case 'image':
      if (child.url) {
        return <img src={child.url} alt={child.alt ?? ''} className="h-auto max-w-full rounded object-cover" />
      }
      return (
        <div className="flex h-14 items-center justify-center rounded bg-muted text-muted-foreground text-xs">
          {child.alt ?? 'Image'}
        </div>
      )

    case 'divider':
      return <hr className="border-border" />

    case 'fields':
      return <CardFields items={child.children ?? []} />

    case 'actions':
      return (
        <CardActions
          messageId={messageId}
          conversationId={conversationId}
          buttons={child.children ?? []}
          readOnly={readOnly}
          onOptimisticReply={onOptimisticReply}
        />
      )

    case 'link':
      return (
        <a
          href={child.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary text-xs underline underline-offset-2 hover:opacity-80"
        >
          {child.label}
        </a>
      )

    default:
      return null
  }
}

function renderCard(
  card: CardElement,
  message: Message,
  readOnly?: boolean,
  onOptimisticReply?: (btn: { buttonId: string; buttonValue: string; buttonLabel: string }) => void,
) {
  return (
    <div className="min-w-[280px] max-w-full space-y-3 rounded-lg border border-border bg-card p-4">
      {card.title && <p className="font-semibold text-foreground text-sm">{card.title}</p>}
      {card.children?.map((child, i) => (
        <CardChildNode
          // biome-ignore lint/suspicious/noArrayIndexKey: card children have no stable id
          key={i}
          child={child}
          messageId={message.id}
          conversationId={message.conversationId}
          readOnly={readOnly}
          onOptimisticReply={onOptimisticReply}
        />
      ))}
    </div>
  )
}

export function MessageCard({
  message,
  parentMessage,
  readOnly = false,
  onOptimisticReply,
}: {
  message: Message
  parentMessage?: Message
  /**
   * When true, card action buttons render as disabled and never post a
   * card-reply. The staff inbox passes this; the customer widget leaves it
   * default false.
   */
  readOnly?: boolean
  /**
   * Fires before the card-reply POST so the surrounding chat surface can
   * render an optimistic outgoing bubble. Only the customer-facing web chat
   * passes this — the staff inbox renders cards read-only.
   */
  onOptimisticReply?: (btn: { buttonId: string; buttonValue: string; buttonLabel: string }) => void
}) {
  const bubbleBase = cn('max-w-full break-words rounded-lg px-3 py-2 text-sm')

  if (message.kind === 'text') {
    const content = message.content as TextContent
    return (
      <div
        className={cn(
          bubbleBase,
          message.role === 'customer' ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground',
        )}
      >
        {content.text ?? '(empty)'}
      </div>
    )
  }

  if (message.kind === 'card') {
    const content = message.content as CardContent
    if (content.card) return renderCard(content.card, message, readOnly, onOptimisticReply)
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
        <pre className="max-h-32 overflow-auto text-muted-foreground text-xs">
          {JSON.stringify(message.content, null, 2)}
        </pre>
      </div>
    )
  }

  if (message.kind === 'card_reply') {
    const content = message.content as CardReplyContent
    const parentTitle = (parentMessage?.content as CardContent | undefined)?.card?.title

    return (
      <div className={cn(bubbleBase, 'border border-border/50 bg-muted text-foreground')}>
        {parentTitle && <p className="mb-0.5 text-2xs text-muted-foreground">↳ {parentTitle}</p>}
        <p className="font-medium text-sm">{content.buttonLabel ?? content.buttonValue ?? content.buttonId ?? '—'}</p>
      </div>
    )
  }

  if (message.kind === 'image') {
    const content = message.content as ImageContent
    if (content.url && (content.type ?? 'image') === 'image') {
      return (
        <div className="overflow-hidden rounded-lg border border-border bg-muted/40">
          <img alt={content.caption ?? 'attachment'} className="max-h-80 w-full object-contain" src={content.url} />
          {content.caption && <p className="px-3 py-2 text-muted-foreground text-xs">{content.caption}</p>}
        </div>
      )
    }
    const label = content.caption ?? content.driveFileId ?? content.url ?? 'Attachment'
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
        {content.url ? (
          <a className="text-xs underline" href={content.url} rel="noreferrer" target="_blank">
            📎 {label}
          </a>
        ) : (
          <span className="text-xs">📎 {label}</span>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <pre className="max-h-32 overflow-auto text-muted-foreground text-xs">
        {JSON.stringify(message.content, null, 2)}
      </pre>
    </div>
  )
}
