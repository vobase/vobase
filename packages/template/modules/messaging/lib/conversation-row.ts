/**
 * Shared conversation-row formatting.
 *
 * The agent sees conversation content in three places — the materialized
 * `CONVERSATION.md` timeline, the wake-cue trigger renderers, and the
 * unread-activity appendix. They all render an audience-labelled row, so the
 * row vocabulary (`**Customer**`, `**[internal] Staff:<id>**`, …), the
 * blockquoting of untrusted body text, and the timezone-aware timestamp live
 * here once instead of drifting per call site.
 *
 * Pure and deterministic — no clock reads, no DB — so it is safe inside
 * frozen-snapshot renderers (the `systemHash` invariant).
 */

import { ORG_TIMEZONE } from '~/runtime/tz'
import type { InternalNote, Message } from '../schema'

/** Audience label for a customer-thread message row. */
export function messageAudienceLabel(role: Message['role']): string {
  if (role === 'customer') return 'Customer'
  if (role === 'agent') return 'Agent → customer'
  if (role === 'staff') return 'Staff → customer'
  return 'System'
}

/**
 * Audience label for an internal-note row. The `[internal]` prefix marks the
 * staff thread the customer never sees — it is the boundary the agent reads to
 * tell customer-visible content from staff-only content.
 *
 * `authorId` is only consulted for the `staff` branch (agent/system notes have
 * no per-author label) and is stripped to the id charset — the label sits on
 * the audience-boundary header line, so a malformed id must not break it.
 */
export function noteAudienceLabel(authorType: InternalNote['authorType'], authorId?: string): string {
  if (authorType === 'agent') return '[internal] Agent'
  if (authorType === 'system') return '[internal] System'
  const safeId = (authorId ?? '').replace(/[^\w:.-]/g, '') || 'unknown'
  return `[internal] Staff:${safeId}`
}

/**
 * Prefix every line of untrusted body text with `> `. The `**…**` row headers
 * are the only thing telling the agent whether a row is customer-visible or
 * the internal staff thread; blockquoting message text and note bodies keeps a
 * column-0 `**` renderer-only, so a customer message or staff note body cannot
 * typographically forge a row of a different audience.
 */
export function blockquoteBody(body: string): string {
  return body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

const TS_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: ORG_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
})

/**
 * Render a conversation timestamp in the org timezone (`ORG_TIMEZONE`) with an
 * explicit offset — e.g. `2026-05-14 18:30 GMT+08:00`. Deterministic for a
 * fixed input (no clock read), so it is safe inside frozen-snapshot renderers.
 */
export function formatRowTimestamp(date: Date): string {
  const parts = TS_FORMAT.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} ${part('timeZoneName')}`
}

export interface ConversationRowOpts {
  /** Audience label — from `messageAudienceLabel` / `noteAudienceLabel`. */
  label: string
  /** Body text. Blockquoted by this function — pass it raw (already truncated if needed). */
  body: string
  /** Org-timezone timestamp from `formatRowTimestamp`. Omitted for the wake cue (the triggering row is "happening now"). */
  timestamp?: string
  /** Freeform header insert before the colon — e.g. `(@staff:u1)` mention tags or a `[card]` action kind. */
  annotation?: string
}

/**
 * One audience-labelled conversation row: a `**<label>** (<ts>) <annotation>:`
 * header followed by the blockquoted body.
 */
export function conversationRow(opts: ConversationRowOpts): string {
  const ts = opts.timestamp ? ` (${opts.timestamp})` : ''
  const annotation = opts.annotation ? ` ${opts.annotation}` : ''
  return `**${opts.label}**${ts}${annotation}:\n${blockquoteBody(opts.body)}`
}
