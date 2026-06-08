/**
 * Canonical single-line summary of a `messaging.messages` row's content,
 * shared by CLI listing, drive transcript rendering, and the wake-cue
 * unread-activity preamble. Keeps all three callers in lockstep so the LLM
 * sees the same `[card: …]` / `[card reply: …]` strings everywhere it reads.
 */

import type { MessageKind } from '@modules/messaging/schema'

interface MessageContentShape {
  text?: string
  card?: { title?: string }
  buttonLabel?: string | null
  buttonValue?: string
}

export function summarizeMessageContent(kind: MessageKind, content: unknown): string {
  const c = (content ?? {}) as MessageContentShape
  if (kind === 'text') return (c.text ?? '').replace(/\s+/g, ' ').trim()
  if (kind === 'card') {
    const title = c.card?.title?.trim()
    return title ? `[card: ${title}]` : '[card]'
  }
  if (kind === 'card_reply') return `[card reply: ${c.buttonLabel ?? c.buttonValue ?? ''}]`
  return `[${kind}]`
}

/**
 * Render one journal/window line as `[role/kind] <summary>`, the canonical shape
 * the learning triage LLM reads. Shared by the automatic triage journal and the
 * manual learning window producer so their formats never drift apart.
 */
export function renderMessageLine(row: { role: string; kind: string; content: unknown }): string {
  return `[${row.role}/${row.kind}] ${summarizeMessageContent(row.kind as MessageKind, row.content)}`.trimEnd()
}
