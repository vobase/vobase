/**
 * createMessageHistoryListener — persists pi AgentMessage[] to agents.messages
 * on every `turn_end` event, keyed to the wake's thread row.
 *
 * Plain `OnEventListener`. Factory closes over `db` (handle at wake-start),
 * `threadId`, the current message snapshot accessor, and a seq cursor.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { ScopedDb } from '@server/common/scoped-db'
import type { AgentEvent } from '@server/events'
import { agentMessages, threads } from '@vobase/core'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export interface MessageHistoryListenerOpts {
  db: ScopedDb
  threadId: string
  /**
   * Returns the current pi AgentMessage[] context for this wake.
   * Called on each `turn_end`; new messages past `seqCursor` are persisted.
   */
  getMessages: () => AgentMessage[]
  /** Primed from loadMessages().length at wake-start so seq stays monotonic. */
  initialSeq?: number
}

export function createMessageHistoryListener(opts: MessageHistoryListenerOpts): (event: AgentEvent) => Promise<void> {
  const { db, threadId, getMessages } = opts
  let seqCursor = opts.initialSeq ?? 0

  return async (event: AgentEvent): Promise<void> => {
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
  }
}
