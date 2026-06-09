import {
  driveFileRawUrl,
  humanBytes,
  type MediaKind,
  mediaKindFromMime,
  mediaKindFromUrlExt,
} from '@modules/drive/lib/format'
import type { MessageAttachmentRef } from '@modules/drive/service/types'
import type { Message } from '@modules/messaging/schema'

import { cn } from '@/lib/utils'
import type { ButtonElement, LinkButtonElement } from './card-actions'
import { CardActions } from './card-actions'
import { CardFields } from './card-fields'
import {
  MediaPlayer,
  MediaPlayerAudio,
  MediaPlayerControls,
  MediaPlayerControlsOverlay,
  MediaPlayerDownload,
  MediaPlayerFullscreen,
  MediaPlayerPiP,
  MediaPlayerPlay,
  MediaPlayerSeek,
  MediaPlayerTime,
  MediaPlayerVideo,
  MediaPlayerVolume,
} from './ui/media-player'

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
  /**
   * Inbound customer images (WhatsApp) store the photo on `attachments[]` and
   * the caption here on `content.text`. Outbound `send_file` images never set
   * this (they carry `caption` instead), so reading it only adds the inbound
   * caption bubble.
   */
  text?: string
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

interface MediaAttachmentProps {
  src: string
  kind: MediaKind
  caption?: string | null
  /** Used only by the image alt and the document-fallback link text. */
  fallbackLabel?: string | null
  /** Used only by the document-fallback link. */
  sizeBytes?: number | null
}

function MediaFrame({
  children,
  caption,
  className,
  captionClassName,
}: {
  children: React.ReactNode
  caption?: string | null
  className?: string
  captionClassName?: string
}) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-muted/40', className)}>
      {children}
      {caption && <p className={cn('px-3 py-2 text-muted-foreground text-xs', captionClassName)}>{caption}</p>}
    </div>
  )
}

function MediaAttachment({ src, kind, caption, fallbackLabel, sizeBytes }: MediaAttachmentProps) {
  if (kind === 'video') {
    return (
      <MediaFrame caption={caption}>
        <MediaPlayer className="w-full">
          <MediaPlayerVideo
            className="max-h-[28rem] w-full bg-black object-contain"
            src={src}
            preload="metadata"
            playsInline
            crossOrigin=""
          />
          <MediaPlayerControls className="flex-col items-stretch gap-1.5">
            <MediaPlayerControlsOverlay />
            <MediaPlayerSeek />
            <div className="flex items-center gap-1.5">
              <MediaPlayerPlay />
              <MediaPlayerVolume expandable />
              <MediaPlayerTime />
              <div className="ml-auto flex items-center gap-1.5">
                <MediaPlayerPiP />
                <MediaPlayerDownload />
                <MediaPlayerFullscreen />
              </div>
            </div>
          </MediaPlayerControls>
        </MediaPlayer>
      </MediaFrame>
    )
  }
  if (kind === 'audio') {
    return (
      <MediaFrame caption={caption} className="p-2" captionClassName="px-1 pt-2">
        <MediaPlayer>
          <MediaPlayerAudio src={src} preload="metadata" crossOrigin="" />
          <MediaPlayerControls className="flex items-center gap-1.5">
            <MediaPlayerPlay />
            <MediaPlayerSeek />
            <MediaPlayerTime />
            <MediaPlayerVolume expandable />
            <MediaPlayerDownload />
          </MediaPlayerControls>
        </MediaPlayer>
      </MediaFrame>
    )
  }
  if (kind === 'image') {
    return (
      <MediaFrame caption={caption}>
        <img alt={caption ?? fallbackLabel ?? 'attachment'} className="max-h-80 w-full object-contain" src={src} />
      </MediaFrame>
    )
  }
  const sizeLabel = humanBytes(sizeBytes ?? null)
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
      <a className="text-xs underline" href={src} rel="noreferrer" target="_blank">
        📎 {caption ?? fallbackLabel ?? 'Attachment'}
        {sizeLabel ? ` (${sizeLabel})` : ''}
      </a>
    </div>
  )
}

function AttachmentBubble({ attachment }: { attachment: MessageAttachmentRef }) {
  return (
    <MediaAttachment
      src={driveFileRawUrl(attachment.driveFileId)}
      kind={mediaKindFromMime(attachment.mimeType) ?? 'document'}
      caption={attachment.caption}
      fallbackLabel={attachment.name ?? attachment.path ?? null}
      sizeBytes={attachment.sizeBytes}
    />
  )
}

/**
 * `kind='image'` is the schema's catch-all bucket for every `send_file` row
 * (CHECK constraint only allows text/image/card/card_reply). `content.type`
 * is the real discriminant set by post-feature writes; legacy rows fall back
 * to attachment mime, then url extension, then plain `'image'`.
 */
function resolveImageKind(content: ImageContent, attachmentRef: MessageAttachmentRef | undefined): MediaKind {
  if (content.type) return content.type
  const fromMime = mediaKindFromMime(attachmentRef?.mimeType)
  if (fromMime) return fromMime
  if (content.url) return mediaKindFromUrlExt(content.url) ?? 'image'
  return 'image'
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
    const attachments = message.attachments ?? []
    // Inbound media (WhatsApp video/audio/image/document) lands as `kind='text'`
    // with attachments on the side — see `messaging/service/conversations.ts`.
    if (attachments.length > 0) {
      const captionText = (content.text ?? '').trim()
      return (
        <div className="flex max-w-[min(78%,560px)] flex-col gap-2">
          {attachments.map((att) => (
            <AttachmentBubble key={att.driveFileId} attachment={att} />
          ))}
          {captionText && (
            <div
              className={cn(
                bubbleBase,
                message.role === 'customer' ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground',
              )}
            >
              {captionText}
            </div>
          )}
        </div>
      )
    }
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
    const attachmentRef = message.attachments?.[0]
    // Outbound `send_file` images carry their source on `content`; inbound
    // customer images carry the file on `attachments[]` (content holds only the
    // caption on `content.text`). Resolve `src` from whichever is present so an
    // inbound photo renders instead of a bare attachment placeholder.
    const src =
      content.url ??
      (content.driveFileId ? driveFileRawUrl(content.driveFileId) : null) ??
      (attachmentRef?.driveFileId ? driveFileRawUrl(attachmentRef.driveFileId) : null)
    if (!src) {
      return (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
          <span className="text-xs">📎 {content.caption ?? content.driveFileId ?? 'Attachment'}</span>
        </div>
      )
    }
    const media = (
      <MediaAttachment
        src={src}
        kind={resolveImageKind(content, attachmentRef)}
        caption={content.caption ?? null}
        fallbackLabel={attachmentRef?.name ?? content.caption ?? content.driveFileId ?? content.url ?? null}
        sizeBytes={attachmentRef?.sizeBytes ?? null}
      />
    )
    // Inbound customer images carry their WhatsApp caption on `content.text`;
    // render it beneath the photo (WhatsApp order). Outbound `send_file` images
    // have no `content.text`, so the bare media renders unchanged.
    const captionText = (content.text ?? '').trim()
    if (!captionText) return media
    return (
      <div className="flex flex-col gap-2">
        {media}
        <div
          className={cn(
            bubbleBase,
            'max-w-[min(78%,560px)]',
            message.role === 'customer' ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground',
          )}
        >
          {captionText}
        </div>
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
