/**
 * Staging store for coexistence `history` webhook chunks.
 *
 * The `field:"history"` webhook can carry thousands of messages per chunk, so
 * the ingress writes each `history[]` element here durably (redelivery-
 * idempotent on the unique key) and acks 200 fast; the drain job reads
 * unprocessed chunks, parses + backfills, then marks them processed.
 *
 * Factory-DI service installed by `module.ts`; free-function wrappers route
 * through the installed instance. Single-writer for `whatsapp_history_chunks`.
 */

import { type WhatsappHistoryChunk, whatsappHistoryChunks } from '@modules/channels/schema'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

export interface StageHistoryChunkInput {
  organizationId: string
  channelInstanceId: string
  phase: number
  chunkOrder: number
  progress: number
  phoneNumberId: string
  declined: boolean
  payload: Record<string, unknown>
}

export interface HistoryStagingService {
  stageChunks(rows: StageHistoryChunkInput[]): Promise<void>
  /** Oldest-first by (phase, chunk_order). `limit` bounds a single drain pass. */
  listUnprocessed(channelInstanceId: string, limit?: number): Promise<WhatsappHistoryChunk[]>
  markProcessed(ids: string[]): Promise<void>
}

export function createHistoryStagingService(deps: { db: ScopedDb }): HistoryStagingService {
  const { db } = deps

  async function stageChunks(rows: StageHistoryChunkInput[]): Promise<void> {
    if (rows.length === 0) return
    // Redelivery-idempotent: a re-sent (instance, phase, chunk_order) is a no-op.
    await db.insert(whatsappHistoryChunks).values(rows).onConflictDoNothing()
  }

  async function listUnprocessed(channelInstanceId: string, limit?: number): Promise<WhatsappHistoryChunk[]> {
    const base = db
      .select()
      .from(whatsappHistoryChunks)
      .where(
        and(eq(whatsappHistoryChunks.channelInstanceId, channelInstanceId), isNull(whatsappHistoryChunks.processedAt)),
      )
      .orderBy(asc(whatsappHistoryChunks.phase), asc(whatsappHistoryChunks.chunkOrder))
    return await (limit === undefined ? base : base.limit(limit))
  }

  async function markProcessed(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await db
      .update(whatsappHistoryChunks)
      .set({ processedAt: new Date() })
      .where(inArray(whatsappHistoryChunks.id, ids))
  }

  return { stageChunks, listUnprocessed, markProcessed }
}

let _current: HistoryStagingService | null = null

export function installHistoryStagingService(svc: HistoryStagingService): void {
  _current = svc
}

export function __resetHistoryStagingServiceForTests(): void {
  _current = null
}

function current(): HistoryStagingService {
  if (!_current) {
    throw new Error('channels/history-staging: service not installed — call installHistoryStagingService()')
  }
  return _current
}

export function stageHistoryChunks(rows: StageHistoryChunkInput[]): Promise<void> {
  return current().stageChunks(rows)
}
export function listUnprocessedHistoryChunks(
  channelInstanceId: string,
  limit?: number,
): Promise<WhatsappHistoryChunk[]> {
  return current().listUnprocessed(channelInstanceId, limit)
}
export function markHistoryChunksProcessed(ids: string[]): Promise<void> {
  return current().markProcessed(ids)
}
