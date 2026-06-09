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

/**
 * Drop toolResult messages whose `toolCallId` has no matching assistant
 * `toolCall` earlier in the transcript. OpenAI Responses rejects the entire
 * request with `400 No tool call found for function call output with call_id …`
 * when this invariant breaks, which wedges every subsequent wake on the
 * conversation. The orphan can appear if the harness ever persists a
 * tool_result without first persisting the assistant turn that issued the
 * call (e.g. a streaming-reassembly drop in the provider adapter).
 *
 * Returns `{ cleaned, droppedCount }`. Order of surviving messages is
 * preserved. Caller decides what to do with the count (warn / metric).
 */
export function pruneOrphanToolResults(history: readonly AgentMessage[]): {
  cleaned: AgentMessage[]
  droppedCount: number
} {
  const seenCallIds = new Set<string>()
  const cleaned: AgentMessage[] = []
  let droppedCount = 0
  for (const m of history) {
    if (m.role === 'assistant') {
      for (const c of m.content ?? []) {
        if (c.type === 'toolCall' && c.id) seenCallIds.add(c.id)
      }
      cleaned.push(m)
    } else if (m.role === 'toolResult') {
      if (m.toolCallId && seenCallIds.has(m.toolCallId)) {
        cleaned.push(m)
      } else {
        droppedCount++
      }
    } else {
      cleaned.push(m)
    }
  }
  return { cleaned, droppedCount }
}

/**
 * Replace `ImageContent` parts in user-turn messages with a `[image]` text
 * marker before persistence. Inbound customer images are injected into the LLM
 * exactly on the wake that introduced them (via the harness `renderTriggerImages`
 * seam); persisting the base64 bytes into `agent_messages` would replay them on
 * every subsequent wake — ballooning token cost and churning the provider prefix
 * cache. We keep the bytes out of history and leave a marker so the transcript
 * still records that an image was sent.
 *
 * Pure + immutable: returns a new array and never mutates the input. Only
 * `role: 'user'` array-content messages are touched; string-content user
 * messages and every other role pass through unchanged.
 */
export function stripImageContent(messages: readonly AgentMessage[]): AgentMessage[] {
  return messages.map((m) => {
    if (m.role !== 'user' || !Array.isArray(m.content)) return m
    const content = m.content.map((part) => (part.type === 'image' ? { type: 'text' as const, text: '[image]' } : part))
    return { ...m, content }
  })
}

export async function setupMessageHistory(input: SetupMessageHistoryInput): Promise<MessageHistory> {
  const { db, agentId, conversationId } = input

  let threadId: string | null = null
  let seqCursor = 0
  let loadedHistory: readonly AgentMessage[] = []

  if (db) {
    try {
      threadId = await resolveThread(db, { agentId, conversationId })
      const history = await loadMessages(db, threadId)
      // Keep seqCursor at the DB row count so subsequent inserts append at the
      // correct seq numbers — we are intentionally NOT rewriting the orphan
      // rows in place, just hiding them from the LLM until upstream is fixed.
      seqCursor = history.length
      const { cleaned, droppedCount } = pruneOrphanToolResults(history)
      if (droppedCount > 0) {
        console.warn(
          `[wake] message-history: dropped ${droppedCount} orphan toolResult(s) on load for thread=${threadId} conversationId=${conversationId} agentId=${agentId}`,
        )
      }
      loadedHistory = cleaned
    } catch (err) {
      console.warn('[wake] message-history setup failed — continuing without persistence', err)
    }
  }

  return {
    loadMessageHistory: loadedHistory.length > 0 ? async () => loadedHistory : undefined,
    onTurnEndSnapshot: async (messages) => {
      if (!db || !threadId) return
      const newMessages = messages.slice(seqCursor)
      if (newMessages.length === 0) return
      const tid = threadId
      // Strip inbound-image bytes to a `[image]` marker before persisting so the
      // base64 payload is never replayed on subsequent wakes (see stripImageContent).
      const rows = stripImageContent(newMessages).map((m, i) => ({
        id: nanoid(10),
        threadId: tid,
        seq: seqCursor + i + 1,
        payload: m as unknown as Record<string, unknown>,
        payloadVersion: 1,
        createdAt: new Date(),
      }))
      await db
        .insert(agentMessages)
        .values(rows)
        .onConflictDoNothing({ target: [agentMessages.threadId, agentMessages.seq] })
      seqCursor += newMessages.length
      await db.update(threads).set({ messageCount: seqCursor, lastActiveAt: new Date() }).where(eq(threads.id, tid))
    },
  }
}
