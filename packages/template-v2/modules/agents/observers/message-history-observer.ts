/**
 * createMessageHistoryObserver — persists pi AgentMessage[] to agents.messages
 * on every `turn_end` event, keyed to the wake's thread row.
 *
 * Design (from plan §3, Write path):
 *   - One observer per wake; registered at boot alongside workspace-sync etc.
 *   - `seqCursor` primed from `messages.length` at wake-start (loadMessages result).
 *   - On `turn_end`, calls `getMessages()` to obtain the current pi context slice,
 *     batch-inserts rows for any messages past the cursor, then advances the cursor.
 *   - Idempotent: (thread_id, seq) UNIQUE + ON CONFLICT DO NOTHING makes a
 *     crashed-mid-checkpoint retry safe.
 *   - `db` must be a raw drizzle handle (not inside a tx) since this is a
 *     background observer, not a domain-mutation co-commit.
 *
 * `getMessages` is a callback rather than a captured array so the caller can
 * point it at pi's live `context.messages` once pi's agentLoop is wired in.
 * During the current hand-rolled loop phase the callback returns [] — the
 * observer becomes a no-op but is already registered, so the wiring commit
 * (commit 4) only has to supply a real callback.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { agentMessages, threads } from '@modules/agents/schema'
import type { AgentEvent } from '@server/contracts/event'
import type { AgentObserver } from '@server/contracts/observer'
import type { ScopedDb } from '@server/contracts/scoped-db'
import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export interface MessageHistoryObserverOpts {
  db: ScopedDb
  threadId: string
  /**
   * Returns the current pi AgentMessage[] context for this wake.
   * Called on each `turn_end`; new messages past `seqCursor` are persisted.
   *
   * During the hand-rolled loop phase, return [] to make the observer a no-op.
   */
  getMessages: () => AgentMessage[]
  /** Primed from loadMessages().length at wake-start so seq stays monotonic. */
  initialSeq?: number
}

export function createMessageHistoryObserver(opts: MessageHistoryObserverOpts): AgentObserver {
  const { db, threadId, getMessages } = opts
  let seqCursor = opts.initialSeq ?? 0

  return {
    id: 'agents:message-history',

    async handle(event: AgentEvent): Promise<void> {
      if (event.type !== 'turn_end') return

      const messages = getMessages()
      // Only persist messages past the last checkpoint.
      const newMessages = messages.slice(seqCursor)
      if (newMessages.length === 0) return

      const rows = newMessages.map((m, i) => ({
        id: nanoid(10),
        threadId,
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

      // Update thread stats
      await db
        .update(threads)
        .set({
          messageCount: seqCursor,
          lastActiveAt: new Date(),
        })
        .where(eq(threads.id, threadId))
    },
  }
}
