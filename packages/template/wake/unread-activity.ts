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
const MAX_SELF = 12

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

/** Agent's own recent outbound — used as a self-anchor so back-to-back wakes don't re-send the same card. */
export interface SelfActivity {
  /** `reply` = text msg, `card` = card msg, `file` = image/file msg, `note` = self-authored internal note. */
  kind: 'reply' | 'card' | 'file' | 'note'
  ts: Date
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
  /** `MAX(messages.created_at) WHERE role IN ('customer','staff')`; `null` when no inbound yet. */
  sinceCustomer: Date | null
  /** Agent's own outbound + self-authored notes since the last customer/staff inbound. */
  selfActivity: readonly SelfActivity[]
  /** True when at least one older self action was dropped by `MAX_SELF`. */
  hasMoreSelf: boolean
}

export interface SnapshotInput {
  db: ScopedDb
  conversationId: string
  agentId: string
}

export async function snapshotUnreadActivity(input: SnapshotInput): Promise<UnreadActivitySnapshot> {
  const { db, conversationId, agentId } = input

  // Two watermarks: `since` (agent's last reply, anchors the inbound view); `sinceCustomer`
  // (last customer/staff inbound, anchors the self-anchor view of what the agent has done
  // in response to the current inbound).
  const [sinceRows, sinceCustomerRows] = await Promise.all([
    db
      .select({ ts: sql<Date | null>`MAX(${messages.createdAt})` })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.role, 'agent'))),
    db
      .select({ ts: sql<Date | null>`MAX(${messages.createdAt})` })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), inArray(messages.role, ['customer', 'staff']))),
  ])
  const since = sinceRows[0]?.ts ?? null
  const sinceCustomer = sinceCustomerRows[0]?.ts ?? null

  const [msgRows, noteRows, selfMsgRows, selfNoteRows] = await Promise.all([
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
          not(and(eq(internalNotes.authorType, 'agent'), eq(internalNotes.authorId, agentId)) ?? sql`false`),
        ),
      )
      .orderBy(asc(internalNotes.createdAt))
      .limit(MAX_NOTES + 1),
    db
      .select({ kind: messages.kind, content: messages.content, createdAt: messages.createdAt })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.role, 'agent'),
          sinceCustomer ? gt(messages.createdAt, sinceCustomer) : undefined,
        ),
      )
      .orderBy(asc(messages.createdAt))
      .limit(MAX_SELF + 1),
    db
      .select({ body: internalNotes.body, createdAt: internalNotes.createdAt })
      .from(internalNotes)
      .where(
        and(
          eq(internalNotes.conversationId, conversationId),
          eq(internalNotes.authorType, 'agent'),
          eq(internalNotes.authorId, agentId),
          sinceCustomer ? gt(internalNotes.createdAt, sinceCustomer) : undefined,
        ),
      )
      .orderBy(asc(internalNotes.createdAt))
      .limit(MAX_SELF + 1),
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

  const selfMerged: SelfActivity[] = [
    ...selfMsgRows.map((r) => ({
      kind: messageKindToSelfKind(r.kind as MessageKind),
      ts: r.createdAt,
      body: truncateForCue(summarizeMessageContent(r.kind as MessageKind, r.content), PER_ITEM_BYTE_CAP),
    })),
    ...selfNoteRows.map((r) => ({
      kind: 'note' as const,
      ts: r.createdAt,
      body: truncateForCue(r.body, PER_ITEM_BYTE_CAP),
    })),
  ].sort((a, b) => a.ts.getTime() - b.ts.getTime())

  return {
    since,
    messages: messagesOut,
    hasMoreMessages: msgRows.length > MAX_MESSAGES,
    notes: notesOut,
    hasMoreNotes: noteRows.length > MAX_NOTES,
    sinceCustomer,
    selfActivity: selfMerged.slice(0, MAX_SELF),
    hasMoreSelf: selfMerged.length > MAX_SELF,
  }
}

function messageKindToSelfKind(kind: MessageKind): SelfActivity['kind'] {
  if (kind === 'card') return 'card'
  if (kind === 'image') return 'file'
  return 'reply'
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
  if (snapshot.messages.length === 0 && snapshot.notes.length === 0 && snapshot.selfActivity.length === 0) return ''

  const lines: string[] = ['## Other recent activity (context)', '']
  if (snapshot.messages.length > 0) {
    const customerCount = snapshot.messages.filter((m) => m.role === 'customer').length
    const staffCount = snapshot.messages.length - customerCount
    const counts = [
      customerCount > 0 ? `${customerCount} customer` : null,
      staffCount > 0 ? `${staffCount} staff` : null,
    ].filter(Boolean)
    lines.push(`**Messages (${counts.join(', ')}):**`)
    for (const m of snapshot.messages) {
      lines.push(`[${formatTs(m.ts)} | ${m.role}]`)
      lines.push(blockquote(m.body))
      lines.push('')
    }
    if (snapshot.hasMoreMessages) {
      lines.push(
        `*(more older messages exist beyond the ${MAX_MESSAGES}-row cap — read ${folder}/MESSAGES.md for the full thread.)*`,
      )
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
  if (snapshot.selfActivity.length > 0) {
    lines.push(`**Your recent actions (since last customer/staff inbound — already done, do not re-send):**`)
    for (const a of snapshot.selfActivity) {
      lines.push(`[${formatTs(a.ts)} | ${a.kind}]`)
      lines.push(blockquote(a.body))
      lines.push('')
    }
    if (snapshot.hasMoreSelf) {
      lines.push(`*(more older actions exist beyond the ${MAX_SELF}-row cap.)*`)
      lines.push('')
    }
  }
  lines.push(
    'The trigger at the top of this turn is what brought this wake. "Messages" and "Internal notes" accumulated since your last reply; "Your recent actions" is what you already sent in response to the current inbound — do not re-fire the same card or reply.',
  )
  return lines.join('\n')
}
