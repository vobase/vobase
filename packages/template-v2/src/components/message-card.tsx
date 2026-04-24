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
}: {
  child: CardChild
  messageId: string
  conversationId: string
}) {
  switch (child.type) {
    case 'text':
      return (
        <p
          className={cn('text-foreground break-words', {
            'text-sm font-semibold': child.style === 'bold',
            'text-sm': child.style === 'plain' || !child.style,
            'text-xs text-muted-foreground': child.style === 'muted',
          })}
        >
          {child.content}
        </p>
      )

    case 'image':
      if (child.url) {
        return <img src={child.url} alt={child.alt ?? ''} className="max-w-full h-auto rounded object-cover" />
      }
      return (
        <div className="h-14 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">
          {child.alt ?? 'Image'}
        </div>
      )

    case 'divider':
      return <hr className="border-border" />

    case 'fields':
      return <CardFields items={child.children ?? []} />

    case 'actions':
      return <CardActions messageId={messageId} conversationId={conversationId} buttons={child.children ?? []} />

    case 'link':
      return (
        <a
          href={child.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary underline underline-offset-2 hover:opacity-80"
        >
          {child.label}
        </a>
      )

    default:
      return null
  }
}

function renderCard(card: CardElement, message: Message) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2 min-w-[220px] max-w-full">
      {card.title && <p className="text-sm font-semibold text-foreground">{card.title}</p>}
      {card.children?.map((child, i) => (
        <CardChildNode
          // biome-ignore lint/suspicious/noArrayIndexKey: card children have no stable id
          key={i}
          child={child}
          messageId={message.id}
          conversationId={message.conversationId}
        />
      ))}
    </div>
  )
}

export function MessageCard({ message, parentMessage }: { message: Message; parentMessage?: Message }) {
  const bubbleBase = cn('rounded-lg px-3 py-2 text-sm max-w-full break-words')

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
    if (content.card) return renderCard(content.card, message)
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
        <pre className="text-mini text-muted-foreground overflow-auto max-h-32">
          {JSON.stringify(message.content, null, 2)}
        </pre>
      </div>
    )
  }

  if (message.kind === 'card_reply') {
    const content = message.content as CardReplyContent
    const parentTitle = (parentMessage?.content as CardContent | undefined)?.card?.title

    return (
      <div className={cn(bubbleBase, 'bg-muted text-foreground border border-border/50')}>
        {parentTitle && <p className="text-2xs text-muted-foreground mb-0.5">↳ {parentTitle}</p>}
        <p className="text-sm font-medium">{content.buttonLabel ?? content.buttonValue ?? content.buttonId ?? '—'}</p>
      </div>
    )
  }

  if (message.kind === 'image') {
    const content = message.content as ImageContent
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <span className="text-xs">📎 {content.caption ?? content.driveFileId ?? 'Image'}</span>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <pre className="text-mini text-muted-foreground overflow-auto max-h-32">
        {JSON.stringify(message.content, null, 2)}
      </pre>
    </div>
  )
}
