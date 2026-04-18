import type { Message } from '@server/contracts/domain-types'
import { cn } from '@/lib/utils'

interface TextContent {
  text?: string
}
interface CardContent {
  card?: {
    type?: string
    title?: string
    children?: Array<{ type?: string; content?: string }>
  }
}
interface ImageContent {
  driveFileId?: string
  caption?: string
}

export function MessageCard({ message }: { message: Message }) {
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
    const card = content.card
    return (
      <div className="rounded-lg border border-border bg-card p-3 space-y-1.5 text-sm min-w-[200px]">
        {card?.title && <p className="font-semibold text-foreground">{card.title}</p>}
        {card?.children?.map((child) => (
          <p key={`${child.type ?? ''}:${child.content ?? ''}`} className="text-foreground/80 text-xs">
            {child.content}
          </p>
        ))}
        {!card && (
          <pre className="text-[11px] text-muted-foreground overflow-auto">
            {JSON.stringify(message.content, null, 2)}
          </pre>
        )}
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

  // card_reply or unknown
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <pre className="text-[11px] text-muted-foreground overflow-auto max-h-32">
        {JSON.stringify(message.content, null, 2)}
      </pre>
    </div>
  )
}
