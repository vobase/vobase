/**
 * Unread-activity snapshot — every conversation-lane wake materializes this
 * once at boot and prepends it to the wake-cue rendered by `wake/trigger.ts`.
 *
 * Why this exists: with the producer-side debounce coalescing rapid bursts,
 * only the LAST customer message's body reaches `trigger.body`. The agent's
 * LLM history (from `harness.messages`) shows its prior reply + a single
 * fresh cue excerpt and confidently responds to that — ignoring the other
 * messages that landed during the burst. Inlining everything new since the
 * last agent reply makes the cue self-sufficient.
 *
 * Watermark: `MAX(created_at) WHERE role='agent'` from `messaging.messages`.
 * More robust than `harness.conversation_events.agent_end` because seeded
 * conversations and out-of-band agent replies still anchor correctly.
 */

import { internalNotes, messages } from '@modules/messaging/schema'
import { and, asc, eq, gt, inArray, ne, or, sql } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

/** Per-item body cap. LLM-friendly excerpt; full body lives in MESSAGES.md / INTERNAL-NOTES.md. */
const BODY_CHAR_CAP = 500
/** Per-section row caps. Older rows get summarised as `(+N more — see file)`. */
const MAX_MESSAGES = 50
const MAX_NOTES = 20

export interface UnreadMessage {
  kind: 'customer_message' | 'staff_message'
  role: 'customer' | 'staff'
  ts: Date
  body: string
  truncated: boolean
}

export interface UnreadNote {
  ts: Date
  authorLabel: string
  body: string
  truncated: boolean
}

export interface UnreadActivitySnapshot {
  /** `MAX(messages.created_at) WHERE role='agent'`; `null` when no agent reply yet. */
  since: Date | null
  messages: readonly UnreadMessage[]
  /** Older messages that didn't fit under `MAX_MESSAGES`. */
  truncatedMessageCount: number
  notes: readonly UnreadNote[]
  /** Older notes that didn't fit under `MAX_NOTES`. */
  truncatedNoteCount: number
}

function truncateBody(body: string): { body: string; truncated: boolean } {
  const trimmed = body.trim()
  if (trimmed.length <= BODY_CHAR_CAP) return { body: trimmed, truncated: false }
  return { body: `${trimmed.slice(0, BODY_CHAR_CAP)}…`, truncated: true }
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object') {
    const c = content as Record<string, unknown>
    if (typeof c.text === 'string') return c.text
    const card = c.card as { title?: string; children?: unknown[] } | undefined
    if (card?.title) return `[card: ${card.title}]`
    if (card) return '[card]'
  }
  return '[non-text content]'
}

export interface SnapshotInput {
  db: ScopedDb
  conversationId: string
  agentId: string
}

export async function snapshotUnreadActivity(input: SnapshotInput): Promise<UnreadActivitySnapshot> {
  const { db, conversationId, agentId } = input

  const sinceRows = await db
    .select({ ts: sql<Date | null>`MAX(${messages.createdAt})` })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.role, 'agent')))
  const since = sinceRows[0]?.ts ?? null

  const msgWindow = since
    ? and(eq(messages.conversationId, conversationId), inArray(messages.role, ['customer', 'staff']), gt(messages.createdAt, since))
    : and(eq(messages.conversationId, conversationId), inArray(messages.role, ['customer', 'staff']))

  const noteWindow = since
    ? and(
        eq(internalNotes.conversationId, conversationId),
        gt(internalNotes.createdAt, since),
        or(ne(internalNotes.authorType, 'agent'), ne(internalNotes.authorId, agentId)),
      )
    : and(
        eq(internalNotes.conversationId, conversationId),
        or(ne(internalNotes.authorType, 'agent'), ne(internalNotes.authorId, agentId)),
      )

  const [msgRows, noteRows] = await Promise.all([
    db
      .select({ role: messages.role, content: messages.content, createdAt: messages.createdAt })
      .from(messages)
      .where(msgWindow)
      .orderBy(asc(messages.createdAt))
      .limit(MAX_MESSAGES + 1),
    db
      .select({
        authorType: internalNotes.authorType,
        authorId: internalNotes.authorId,
        body: internalNotes.body,
        createdAt: internalNotes.createdAt,
      })
      .from(internalNotes)
      .where(noteWindow)
      .orderBy(asc(internalNotes.createdAt))
      .limit(MAX_NOTES + 1),
  ])

  const truncatedMessageCount = Math.max(0, msgRows.length - MAX_MESSAGES)
  const truncatedNoteCount = Math.max(0, noteRows.length - MAX_NOTES)

  const messagesOut: UnreadMessage[] = msgRows.slice(0, MAX_MESSAGES).map((r) => {
    const role = r.role as 'customer' | 'staff'
    const { body, truncated } = truncateBody(extractMessageText(r.content))
    return {
      kind: role === 'customer' ? 'customer_message' : 'staff_message',
      role,
      ts: r.createdAt,
      body,
      truncated,
    }
  })

  const notesOut: UnreadNote[] = noteRows.slice(0, MAX_NOTES).map((r) => {
    const { body, truncated } = truncateBody(r.body)
    const label = r.authorType === 'agent' ? `agent:${r.authorId}` : r.authorType === 'staff' ? `staff:${r.authorId}` : 'system'
    return { ts: r.createdAt, authorLabel: label, body, truncated }
  })

  return { since, messages: messagesOut, truncatedMessageCount, notes: notesOut, truncatedNoteCount }
}

function formatTs(ts: Date): string {
  return ts.toISOString().slice(11, 16) // HH:MM (UTC)
}

function quote(body: string): string {
  return body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

/**
 * Render the snapshot as a markdown block. Returns `''` when nothing is
 * unread, so callers can `${pre}${cue}` without conditional plumbing.
 */
export function renderUnreadActivity(snapshot: UnreadActivitySnapshot, folder: string): string {
  if (snapshot.messages.length === 0 && snapshot.notes.length === 0) return ''

  const lines: string[] = ['## Activity since your last reply', '']
  if (snapshot.messages.length > 0) {
    const customerCount = snapshot.messages.filter((m) => m.role === 'customer').length
    const staffCount = snapshot.messages.length - customerCount
    const counts = [
      customerCount > 0 ? `${customerCount} customer` : null,
      staffCount > 0 ? `${staffCount} staff echo` : null,
    ].filter(Boolean)
    lines.push(`**Messages (${counts.join(', ')}):**`)
    for (const m of snapshot.messages) {
      const tag = m.role === 'customer' ? 'customer' : 'staff'
      lines.push(`[${formatTs(m.ts)} | ${tag}]`)
      lines.push(quote(m.body))
      lines.push('')
    }
    if (snapshot.truncatedMessageCount > 0) {
      lines.push(`*(+${snapshot.truncatedMessageCount} older message(s) omitted — read ${folder}/MESSAGES.md for the full thread.)*`)
      lines.push('')
    }
  }
  if (snapshot.notes.length > 0) {
    lines.push(`**Internal notes (${snapshot.notes.length} new from non-self):**`)
    for (const n of snapshot.notes) {
      lines.push(`[${formatTs(n.ts)} | ${n.authorLabel}]`)
      lines.push(quote(n.body))
      lines.push('')
    }
    if (snapshot.truncatedNoteCount > 0) {
      lines.push(`*(+${snapshot.truncatedNoteCount} older note(s) omitted — read ${folder}/INTERNAL-NOTES.md.)*`)
      lines.push('')
    }
  }
  lines.push(
    'The list above is authoritative for what is new — do not assume the trigger cue below is the only new item. Older context still lives in the files referenced.',
  )
  return lines.join('\n')
}
