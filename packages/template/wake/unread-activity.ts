/**
 * Unread-activity snapshot — every conversation-lane wake materializes this
 * once at boot and prepends it to the wake-cue rendered by `wake/trigger.ts`.
 *
 * Why this exists: the producer-side debounce coalesces rapid bursts, so only
 * the last customer message's body reaches `trigger.body`. The agent's LLM
 * history (from `harness.messages`) plus that single excerpt is too thin a
 * signal — agents reply to the excerpt and ignore the rest. Inlining
 * everything new since the last agent reply makes the cue self-sufficient.
 *
 * Watermark: `MAX(created_at) WHERE role='agent'` from `messaging.messages`.
 * More robust than `harness.conversation_events.agent_end` because seeded
 * conversations and out-of-band agent rows still anchor correctly. Note: a
 * staff-authored direct message does NOT bump the watermark — that's the
 * desired behavior (the agent hasn't replied to it, so it stays unread).
 */

import { internalNotes, type MessageKind, messages } from '@modules/messaging/schema'
import { summarizeMessageContent } from '@modules/messaging/service/summarize-content'
import { and, asc, eq, gt, inArray, not, sql } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'
import { blockquote, truncateForCue } from './trigger'

/** Per-item byte cap. Reuses the cue truncation pipeline so emoji/CJK count correctly. */
const PER_ITEM_BYTE_CAP = 800
/** Per-section row caps — overflow surfaces a `read <file>` pointer instead of an inflated count. */
const MAX_MESSAGES = 50
const MAX_NOTES = 20

export interface UnreadMessage {
  role: 'customer' | 'staff'
  ts: Date
  body: string
}

export interface UnreadNote {
  ts: Date
  authorLabel: string
  body: string
}

export interface UnreadActivitySnapshot {
  /** `MAX(messages.created_at) WHERE role='agent'`; `null` when no agent reply yet. */
  since: Date | null
  messages: readonly UnreadMessage[]
  /** True when at least one older message was dropped by `MAX_MESSAGES`. */
  hasMoreMessages: boolean
  notes: readonly UnreadNote[]
  /** True when at least one older note was dropped by `MAX_NOTES`. */
  hasMoreNotes: boolean
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

  const [msgRows, noteRows] = await Promise.all([
    db
      .select({ role: messages.role, kind: messages.kind, content: messages.content, createdAt: messages.createdAt })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          inArray(messages.role, ['customer', 'staff']),
          since ? gt(messages.createdAt, since) : undefined,
        ),
      )
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
      .where(
        and(
          eq(internalNotes.conversationId, conversationId),
          since ? gt(internalNotes.createdAt, since) : undefined,
          not(and(eq(internalNotes.authorType, 'agent'), eq(internalNotes.authorId, agentId))!),
        ),
      )
      .orderBy(asc(internalNotes.createdAt))
      .limit(MAX_NOTES + 1),
  ])

  const messagesOut: UnreadMessage[] = msgRows.slice(0, MAX_MESSAGES).map((r) => ({
    role: r.role as 'customer' | 'staff',
    ts: r.createdAt,
    body: truncateForCue(summarizeMessageContent(r.kind as MessageKind, r.content), PER_ITEM_BYTE_CAP),
  }))

  const notesOut: UnreadNote[] = noteRows.slice(0, MAX_NOTES).map((r) => ({
    ts: r.createdAt,
    authorLabel: r.authorType === 'system' ? 'system' : `${r.authorType}:${r.authorId}`,
    body: truncateForCue(r.body, PER_ITEM_BYTE_CAP),
  }))

  return {
    since,
    messages: messagesOut,
    hasMoreMessages: msgRows.length > MAX_MESSAGES,
    notes: notesOut,
    hasMoreNotes: noteRows.length > MAX_NOTES,
  }
}

/** `YYYY-MM-DD HH:MM` UTC — opaque magic-index slice; comment is the only thing telling readers what those indices mean. */
function formatTs(ts: Date): string {
  return ts.toISOString().slice(0, 16).replace('T', ' ')
}

/**
 * Render the snapshot as a markdown block. Returns `''` when nothing is
 * unread so callers can append unconditionally without guard plumbing.
 */
export function renderUnreadActivity(snapshot: UnreadActivitySnapshot, folder: string): string {
  if (snapshot.messages.length === 0 && snapshot.notes.length === 0) return ''

  const lines: string[] = ['## Other recent activity (context)', '']
  if (snapshot.messages.length > 0) {
    const customerCount = snapshot.messages.filter((m) => m.role === 'customer').length
    const staffCount = snapshot.messages.length - customerCount
    const counts = [customerCount > 0 ? `${customerCount} customer` : null, staffCount > 0 ? `${staffCount} staff` : null].filter(
      Boolean,
    )
    lines.push(`**Messages (${counts.join(', ')}):**`)
    for (const m of snapshot.messages) {
      lines.push(`[${formatTs(m.ts)} | ${m.role}]`)
      lines.push(blockquote(m.body))
      lines.push('')
    }
    if (snapshot.hasMoreMessages) {
      lines.push(`*(more older messages exist beyond the ${MAX_MESSAGES}-row cap — read ${folder}/MESSAGES.md for the full thread.)*`)
      lines.push('')
    }
  }
  if (snapshot.notes.length > 0) {
    lines.push(`**Internal notes (${snapshot.notes.length} new from non-self):**`)
    for (const n of snapshot.notes) {
      lines.push(`[${formatTs(n.ts)} | ${n.authorLabel}]`)
      lines.push(blockquote(n.body))
      lines.push('')
    }
    if (snapshot.hasMoreNotes) {
      lines.push(`*(more older notes exist beyond the ${MAX_NOTES}-row cap — read ${folder}/INTERNAL-NOTES.md.)*`)
      lines.push('')
    }
  }
  lines.push(
    'Everything above is what has accumulated since your last reply. The trigger at the top of this turn is what brought this wake — anything here that the trigger does not already cover is supplementary signal.',
  )
  return lines.join('\n')
}
