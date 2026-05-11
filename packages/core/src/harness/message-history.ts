/**
 * message-history — load/save pi AgentMessage[] per agent thread.
 *
 * Two public helpers:
 *   - `resolveThread` — UPSERT thread row by (agentId, conversationId) or
 *     (agentId, cronKey), INSERT new for adhoc. Returns the thread id.
 *   - `loadMessages` — SELECT * FROM harness.messages WHERE thread_id = ?
 *     ORDER BY seq, return payloads as AgentMessage[].
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { asc, eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { nanoid } from 'nanoid'

import { agentMessages, threads } from '../schemas/harness'

export type MessageHistoryDb = PostgresJsDatabase<Record<string, unknown>>

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
export async function resolveThread(db: MessageHistoryDb, opts: ResolveThreadOpts): Promise<string> {
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
export async function loadMessages(db: MessageHistoryDb, threadId: string): Promise<AgentMessage[]> {
  const rows = await db
    .select({ payload: agentMessages.payload })
    .from(agentMessages)
    .where(eq(agentMessages.threadId, threadId))
    .orderBy(asc(agentMessages.seq))

  return rows.map((r) => r.payload as AgentMessage)
}
