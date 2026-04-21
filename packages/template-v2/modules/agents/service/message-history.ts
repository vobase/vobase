/**
 * message-history — load/save pi AgentMessage[] per agent thread.
 *
 * Two public helpers:
 *   - `resolveThread` — UPSERT thread row by (agentId, conversationId) or
 *     (agentId, cronKey), INSERT new for adhoc. Returns the thread id.
 *   - `loadMessages` — SELECT * FROM agents.messages WHERE thread_id = ?
 *     ORDER BY seq, return payloads as AgentMessage[].
 *
 * The write path lives in `createMessageHistoryObserver` which listens for
 * `turn_end` events and batch-inserts new messages since the last checkpoint.
 * That keeps this file read-only and free of observer coupling.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { agentMessages, threads } from '@modules/agents/schema'
import type { ScopedDb } from '@server/contracts/scoped-db'
import { asc, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export interface ResolveThreadOpts {
  agentId: string
  /** Set when kind='conversation'. */
  conversationId?: string
  /** Set when kind='cron'. */
  cronKey?: string
}

/**
 * UPSERT thread row and return its id.
 *
 * - kind='conversation': upserts on (agentId, conversationId) unique index
 * - kind='cron': upserts on (agentId, cronKey) unique index
 * - kind='adhoc': always inserts a fresh thread
 */
export async function resolveThread(db: ScopedDb, opts: ResolveThreadOpts): Promise<string> {
  if (opts.conversationId) {
    const rows = await db
      .insert(threads)
      .values({
        id: nanoid(10),
        agentId: opts.agentId,
        kind: 'conversation',
        conversationId: opts.conversationId,
        lastActiveAt: new Date(),
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [threads.agentId, threads.conversationId],
        targetWhere: sql`${threads.conversationId} IS NOT NULL`,
        set: { lastActiveAt: new Date() },
      })
      .returning({ id: threads.id })
    const id = rows[0]?.id
    if (!id) throw new Error('resolveThread: upsert returned no rows')
    return id
  }

  if (opts.cronKey) {
    const rows = await db
      .insert(threads)
      .values({
        id: nanoid(10),
        agentId: opts.agentId,
        kind: 'cron',
        cronKey: opts.cronKey,
        lastActiveAt: new Date(),
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [threads.agentId, threads.cronKey],
        targetWhere: sql`${threads.cronKey} IS NOT NULL`,
        set: { lastActiveAt: new Date() },
      })
      .returning({ id: threads.id })
    const id = rows[0]?.id
    if (!id) throw new Error('resolveThread: upsert returned no rows')
    return id
  }

  // adhoc — always a fresh thread
  const id = nanoid(10)
  await db.insert(threads).values({
    id,
    agentId: opts.agentId,
    kind: 'adhoc',
    lastActiveAt: new Date(),
    createdAt: new Date(),
  })
  return id
}

/**
 * Load all pi AgentMessage[] for a thread, ordered by seq ascending.
 *
 * Returns [] when no messages exist (first wake for this thread).
 */
export async function loadMessages(db: ScopedDb, threadId: string): Promise<AgentMessage[]> {
  const rows = await db
    .select({ payload: agentMessages.payload })
    .from(agentMessages)
    .where(eq(agentMessages.threadId, threadId))
    .orderBy(asc(agentMessages.seq))

  return rows.map((r) => r.payload as AgentMessage)
}
