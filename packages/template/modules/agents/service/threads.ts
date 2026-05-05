/**
 * Sole write path for `operator_threads` and `operator_thread_messages`.
 *
 * Routes through one transaction per mutation so the row + the seq counter
 * stay consistent; emits `pg_notify` on commit so the frontend can refresh
 * via `use-realtime-invalidation`.
 *
 * `check:shape` enforces that only this file may `.insert/update/delete()`
 * the two thread tables — cross-module callers must come through these
 * exports.
 */

import { operatorThreadMessages, operatorThreads } from '@modules/agents/schema'
import type { RealtimePayload } from '@vobase/core'
import { and, asc, desc, eq, sql } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

export interface CreateThreadInput {
  organizationId: string
  agentId: string
  createdBy: string
  title?: string | null
  /** Optional first message — when omitted, the thread is created empty. */
  firstMessage?: { role: 'user' | 'system'; content: string; payload?: Record<string, unknown> }
}

export interface AppendMessageInput {
  threadId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  payload?: Record<string, unknown>
}

export interface CloseThreadInput {
  threadId: string
  status?: 'closed' | 'archived'
}

export interface ThreadsService {
  createThread(input: CreateThreadInput): Promise<{ threadId: string }>
  appendMessage(input: AppendMessageInput): Promise<{ messageId: string; seq: number }>
  closeThread(input: CloseThreadInput): Promise<void>
  listForCreator(input: {
    organizationId: string
    createdBy: string
    limit?: number
  }): Promise<Array<{ id: string; title: string | null; status: string; lastTurnAt: Date | null; agentId: string }>>
  listMessages(
    threadId: string,
    opts?: { limit?: number },
  ): Promise<Array<{ id: string; seq: number; role: string; content: string; createdAt: Date }>>
}

export interface ThreadsServiceDeps {
  db: ScopedDb
  /** Real-time notify; defaults to a no-op for tests. */
  notify?: (payload: RealtimePayload) => void
}

export function createThreadsService(deps: ThreadsServiceDeps): ThreadsService {
  const db = deps.db
  const notify = deps.notify ?? (() => undefined)

  return {
    async createThread(input) {
      const threadId = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(operatorThreads)
          .values({
            organizationId: input.organizationId,
            agentId: input.agentId,
            createdBy: input.createdBy,
            title: input.title ?? null,
            status: 'open',
            lastTurnAt: input.firstMessage ? new Date() : null,
          })
          .returning({ id: operatorThreads.id })
        const id = inserted[0]?.id
        if (!id) throw new Error('createThread: insert returned no row')
        if (input.firstMessage) {
          await tx.insert(operatorThreadMessages).values({
            threadId: id,
            seq: 1,
            role: input.firstMessage.role,
            content: input.firstMessage.content,
            payload: input.firstMessage.payload ?? {},
          })
        }
        return id
      })
      notify({ table: 'operator_threads', id: threadId, action: 'insert' })
      return { threadId }
    },

    async appendMessage(input) {
      // `INSERT … SELECT COALESCE(MAX(seq),0)+1` computes the next seq inside
      // the same statement that writes the row. Two concurrent appendMessage
      // calls on the same thread are now serialised by the row insert under
      // the table's per-row lock — no MAX-then-insert race window.
      const result = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(operatorThreadMessages)
          .values({
            threadId: input.threadId,
            seq: sql<number>`(SELECT COALESCE(MAX(${operatorThreadMessages.seq}), 0) + 1 FROM ${operatorThreadMessages} WHERE ${operatorThreadMessages.threadId} = ${input.threadId})`,
            role: input.role,
            content: input.content,
            payload: input.payload ?? {},
          })
          .returning({ id: operatorThreadMessages.id, seq: operatorThreadMessages.seq })
        await tx.update(operatorThreads).set({ lastTurnAt: new Date() }).where(eq(operatorThreads.id, input.threadId))
        const row = inserted[0]
        if (!row) throw new Error('appendMessage: insert returned no row')
        return { messageId: row.id, seq: row.seq }
      })
      notify({ table: 'operator_thread_messages', id: result.messageId, action: 'insert' })
      return result
    },

    async closeThread(input) {
      await db
        .update(operatorThreads)
        .set({ status: input.status ?? 'closed' })
        .where(eq(operatorThreads.id, input.threadId))
      notify({ table: 'operator_threads', id: input.threadId, action: 'update' })
    },

    // biome-ignore lint/suspicious/useAwait: ThreadsService contract requires async signature
    async listForCreator({ organizationId, createdBy, limit = 50 }) {
      return db
        .select({
          id: operatorThreads.id,
          title: operatorThreads.title,
          status: operatorThreads.status,
          lastTurnAt: operatorThreads.lastTurnAt,
          agentId: operatorThreads.agentId,
        })
        .from(operatorThreads)
        .where(and(eq(operatorThreads.organizationId, organizationId), eq(operatorThreads.createdBy, createdBy)))
        .orderBy(desc(sql`COALESCE(${operatorThreads.lastTurnAt}, ${operatorThreads.createdAt})`))
        .limit(limit)
    },

    // biome-ignore lint/suspicious/useAwait: ThreadsService contract requires async signature
    async listMessages(threadId, opts) {
      return db
        .select({
          id: operatorThreadMessages.id,
          seq: operatorThreadMessages.seq,
          role: operatorThreadMessages.role,
          content: operatorThreadMessages.content,
          createdAt: operatorThreadMessages.createdAt,
        })
        .from(operatorThreadMessages)
        .where(eq(operatorThreadMessages.threadId, threadId))
        .orderBy(asc(operatorThreadMessages.seq))
        .limit(opts?.limit ?? 200)
    },
  }
}

let _currentService: ThreadsService | null = null

export function installThreadsService(svc: ThreadsService): void {
  _currentService = svc
}

export function __resetThreadsServiceForTests(): void {
  _currentService = null
}

function current(): ThreadsService {
  if (!_currentService) throw new Error('agents/threads: service not installed')
  return _currentService
}

export const threads = {
  createThread: (input: CreateThreadInput) => current().createThread(input),
  appendMessage: (input: AppendMessageInput) => current().appendMessage(input),
  closeThread: (input: CloseThreadInput) => current().closeThread(input),
  listForCreator: (input: { organizationId: string; createdBy: string; limit?: number }) =>
    current().listForCreator(input),
  listMessages: (threadId: string, opts?: { limit?: number }) => current().listMessages(threadId, opts),
}
