import type { VobaseDb } from '@vobase/core'
import { and, eq, isNull } from 'drizzle-orm'

import { kbChunks, kbDocuments } from '../schema'
import { processDocument } from './pipeline'
import { markdownToPlate } from './plate-deserialize'

interface MigrateOptions {
  /**
   * Re-chunk and re-embed migrated documents using the new blockChunk() pipeline.
   * Defaults to false to avoid unnecessary embedding API costs — when false, only
   * content and rawContent are backfilled (existing chunks/embeddings are kept).
   */
  reembed?: boolean
}

/**
 * Backfill Plate Value content for existing documents that have text chunks but
 * no structured content stored yet.
 *
 * Queries: status = 'ready' AND content IS NULL
 * Skips: errored, pending, processing documents.
 *
 * For each eligible document:
 * - Fetches existing chunks (text), concatenates them, and parses via markdownToPlate().
 * - Stores the resulting Plate Value as both `content` and `rawContent`.
 * - If `reembed: true`, fully re-processes through blockChunk() + embeddings pipeline.
 *
 * @returns Number of documents migrated.
 */
export async function migrateExistingDocuments(db: VobaseDb, options?: MigrateOptions): Promise<number> {
  const reembed = options?.reembed ?? false

  const docs = await db
    .select({ id: kbDocuments.id })
    .from(kbDocuments)
    .where(and(eq(kbDocuments.status, 'ready'), isNull(kbDocuments.content)))

  let migrated = 0

  for (const doc of docs) {
    const chunks = await db
      .select({ content: kbChunks.content, chunkIndex: kbChunks.chunkIndex })
      .from(kbChunks)
      .where(eq(kbChunks.documentId, doc.id))
      .orderBy(kbChunks.chunkIndex)

    if (chunks.length === 0) continue

    const concatenated = chunks.map((c) => c.content).join('\n\n')
    const plateValue = markdownToPlate(concatenated)

    if (reembed) {
      // Full re-process: new block-aware chunking + re-embed + store Plate Value
      await processDocument(db, doc.id, plateValue)
    } else {
      // Backfill only: store Plate Value without touching existing chunks/embeddings
      await db
        .update(kbDocuments)
        .set({
          content: plateValue as unknown,
          rawContent: plateValue as unknown,
        })
        .where(eq(kbDocuments.id, doc.id))
    }

    migrated++
  }

  return migrated
}
