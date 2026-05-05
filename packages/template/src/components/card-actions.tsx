import { useMutation } from '@tanstack/react-query'

import { channelWebClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'

export interface ButtonElement {
  type: 'button'
  id: string
  label: string
  value?: string
  style?: 'primary' | 'danger' | 'default'
  disabled?: boolean
  actionType?: 'action' | 'modal'
}

export interface LinkButtonElement {
  type: 'link-button'
  label: string
  url: string
  style?: 'primary' | 'danger' | 'default'
}

interface CardActionsProps {
  messageId: string
  conversationId: string
  buttons: Array<ButtonElement | LinkButtonElement>
  /**
   * When true, render buttons as disabled and never call the card-reply
   * endpoint. The staff inbox passes this — buttons there are an audit view of
   * what the customer sees, not actionable. Defaults to false (customer widget
   * usage where taps must post replies).
   */
  readOnly?: boolean
}

export interface CardReplyPayload {
  messageId: string
  buttonId: string
  buttonValue: string
  buttonLabel: string
}

export async function postCardReply(payload: CardReplyPayload): Promise<void> {
  const res = await channelWebClient['card-reply'].$post(
    {},
    {
      init: {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    },
  )
  if (!res.ok) throw new Error(`card-reply failed: ${res.status}`)
}

// `primary` renders identically to `default` on the web inbox — the leading
// button shouldn't be visually emphasised the way native WhatsApp / Slack /
// Teams renderers might handle it. `danger` keeps the destructive red so
// destructive-action cards still read as such on web.
const buttonStyleMap: Record<string, string> = {
  primary: 'border border-border bg-background hover:bg-muted text-foreground',
  danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  default: 'border border-border bg-background hover:bg-muted text-foreground',
}

export function CardActions({ messageId, buttons, readOnly = false }: CardActionsProps) {
  const mutation = useMutation({
    mutationFn: (btn: ButtonElement) =>
      postCardReply({ messageId, buttonId: btn.id, buttonValue: btn.value ?? btn.id, buttonLabel: btn.label }),
  })

  const pendingId = mutation.isPending ? (mutation.variables as ButtonElement | undefined)?.id : null
  const repliedId = mutation.isSuccess ? (mutation.variables as ButtonElement | undefined)?.id : null

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {buttons.map((btn, i) => {
        if (btn.type === 'link-button') {
          // Link buttons stay clickable in read-only mode — they navigate to
          // an external URL, not post a card-reply, so staff opening the doc
          // link is harmless and useful.
          return (
            <a
              // biome-ignore lint/suspicious/noArrayIndexKey: link buttons have no stable id
              key={i}
              href={btn.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'inline-flex items-center rounded-md px-3 py-1.5 font-medium text-xs transition-colors',
                buttonStyleMap[btn.style ?? 'default'] ?? buttonStyleMap.default,
              )}
            >
              {btn.label}&nbsp;↗
            </a>
          )
        }

        const isInFlight = !readOnly && pendingId === btn.id
        const isDone = !readOnly && repliedId === btn.id
        const isDisabled = readOnly || btn.disabled || mutation.isPending || mutation.isSuccess

        return (
          <button
            key={btn.id}
            type="button"
            disabled={isDisabled}
            aria-disabled={isDisabled}
            tabIndex={readOnly ? -1 : undefined}
            onClick={readOnly ? undefined : () => mutation.mutate(btn)}
            className={cn(
              'inline-flex items-center rounded-md px-3 py-1.5 font-medium text-xs transition-colors',
              buttonStyleMap[btn.style ?? 'default'] ?? buttonStyleMap.default,
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {isInFlight ? '…' : isDone ? `✓ ${btn.label}` : btn.label}
          </button>
        )
      })}
    </div>
  )
}
