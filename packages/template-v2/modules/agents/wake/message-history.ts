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
  let seqCursor = 0
  let loadedHistory: readonly AgentMessage[] = []

  if (db) {
    try {
      threadId = await resolveThread(db, { agentId, conversationId })
      const history = await loadMessages(db, threadId)
      loadedHistory = history
      seqCursor = history.length
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
      const rows = newMessages.map((m, i) => ({
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
