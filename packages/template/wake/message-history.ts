/**
 * Per-wake message-history persistence.
 *
 * Resolves (or creates) the agent thread row for `(agentId, conversationId)`,
 * loads the previously-persisted assistant messages so the harness can replay
 * them as conversation history, and returns an `onTurnEndSnapshot` callback
 * that appends new messages to `agent_messages` and bumps the thread row's
 * counters after every turn.
 *
 * `seqCursor` lives in this module's closure so each call to
 * `setupMessageHistory` produces a fresh, wake-scoped cursor — concurrent
 * wakes on different conversations don't share state.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { agentMessages, loadMessages, resolveThread, threads } from '@vobase/core'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import type { ScopedDb } from '~/runtime'

export interface SetupMessageHistoryInput {
  db: ScopedDb | undefined
  agentId: string
  conversationId: string
}

export interface MessageHistory {
  /** Pass to `createHarness({ loadMessageHistory })` when there is prior history. */
  loadMessageHistory: (() => Promise<readonly AgentMessage[]>) | undefined
  /** Pass to `createHarness({ onTurnEndSnapshot })` to persist new turns. */
  onTurnEndSnapshot: (messages: readonly AgentMessage[]) => Promise<void>
}

export async function setupMessageHistory(input: SetupMessageHistoryInput): Promise<MessageHistory> {
  const { db, agentId, conversationId } = input

  let threadId: string | null = null
  // Two cursors:
  //   - `dbSeqCursor`  — the next DB `seq` value to assign. Counts EVERY
  //                       row in `harness.messages` for this thread, including
  //                       legacy empty-content rows we now skip on load.
  //   - `harnessIndex` — how many items the harness has already seen in its
  //                       accumulated `messages` array. Matches the sanitized
  //                       history length on first wake, then grows by what
  //                       the harness produced even if we skipped persisting
  //                       some of those items.
  let dbSeqCursor = 0
  let harnessIndex = 0
  let loadedHistory: readonly AgentMessage[] = []

  if (db) {
    try {
      threadId = await resolveThread(db, { agentId, conversationId })
      const history = await loadMessages(db, threadId)
      loadedHistory = history
      dbSeqCursor = history.length
    } catch (err) {
      console.warn('[wake] message-history setup failed — continuing without persistence', err)
    }
  }

  /**
   * Anthropic's extended-thinking / response-signature feature can produce
   * assistant turns whose visible `text` is empty but whose `textSignature`
   * carries the encoded content (`{text: "", type: "text", textSignature: ...}`).
   * Replaying that on the next turn trips Anthropic's "text content blocks
   * must be non-empty" 400. Drop empty text blocks; if a message ends up
   * with zero content blocks, drop the whole turn.
   */
  function isMessageNonEmpty(m: AgentMessage): boolean {
    const content = (m as { content?: unknown }).content
    if (!Array.isArray(content)) return true
    if (content.length === 0) return false
    return content.some((block) => {
      if (!block || typeof block !== 'object') return true
      const b = block as { type?: string; text?: unknown }
      if (b.type === 'text') return typeof b.text === 'string' && b.text.length > 0
      return true
    })
  }

  function sanitizeMessage(m: AgentMessage): AgentMessage | null {
    const content = (m as { content?: unknown }).content
    if (!Array.isArray(content)) return m
    const cleaned = content.filter((block) => {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
        const text = (block as { text?: unknown }).text
        return typeof text === 'string' && text.length > 0
      }
      return true
    })
    if (cleaned.length === 0) return null
    return { ...(m as object), content: cleaned } as AgentMessage
  }

  function sanitizeHistory(history: readonly AgentMessage[]): readonly AgentMessage[] {
    const out: AgentMessage[] = []
    for (const m of history) {
      const cleaned = sanitizeMessage(m)
      if (cleaned) out.push(cleaned)
    }
    return out
  }

  const sanitized = sanitizeHistory(loadedHistory)
  harnessIndex = sanitized.length

  return {
    loadMessageHistory: sanitized.length > 0 ? async () => sanitized : undefined,
    onTurnEndSnapshot: async (messages) => {
      if (!db || !threadId) return
      const newMessages = messages.slice(harnessIndex)
      harnessIndex = messages.length
      if (newMessages.length === 0) return
      // Persist only non-empty messages. Empty (textSignature-only) turns
      // are diagnostic artifacts of extended-thinking responses and would
      // break the next wake's replay if we wrote them.
      const persistable = newMessages.filter(isMessageNonEmpty)
      if (persistable.length === 0) return
      const tid = threadId
      const rows = persistable.map((m, i) => ({
        id: nanoid(10),
        threadId: tid,
        seq: dbSeqCursor + i + 1,
        payload: m as unknown as Record<string, unknown>,
        payloadVersion: 1,
        createdAt: new Date(),
      }))
      await db
        .insert(agentMessages)
        .values(rows)
        .onConflictDoNothing({ target: [agentMessages.threadId, agentMessages.seq] })
      dbSeqCursor += persistable.length
      await db.update(threads).set({ messageCount: dbSeqCursor, lastActiveAt: new Date() }).where(eq(threads.id, tid))
    },
  }
}
