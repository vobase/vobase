import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { kbChunks, kbDocuments } from '../schema';
import { blockChunk } from './chunker';
import { embedChunks } from './embeddings';
import type { PlateValue } from './plate-types';

/**
 * Process a document: chunk → embed → store in kbChunks.
 * searchVector (tsvector) is generated automatically by PostgreSQL.
 * Updates the document status through the pipeline.
 *
 * @param value    Plate Value (structured document content)
 * @param rawValue Immutable original extraction. Defaults to value when omitted.
 */
export async function processDocument(
  db: VobaseDb,
  documentId: string,
  value: PlateValue,
  rawValue?: PlateValue,
): Promise<void> {
  const storedRaw = rawValue ?? value;

  // Mark as processing
  await db
    .update(kbDocuments)
    .set({ status: 'processing' })
    .where(eq(kbDocuments.id, documentId));

  try {
    // 1. Chunk the Plate Value; discard empty chunks
    const chunks = blockChunk(value).filter((c) => c.content.trim().length > 0);

    if (chunks.length === 0) {
      await db
        .update(kbDocuments)
        .set({
          status: 'ready',
          chunkCount: 0,
          content: value as unknown,
          rawContent: storedRaw as unknown,
        })
        .where(eq(kbDocuments.id, documentId));
      return;
    }

    // 2. Generate embeddings for all chunks
    const embeddings = await embedChunks(chunks.map((c) => c.content));

    // 3. Insert chunks with embeddings in a transaction
    //    PostgreSQL automatically populates searchVector via generatedAlwaysAs.
    await db.transaction(async (tx) => {
      await tx.insert(kbChunks).values(
        chunks.map((chunk, i) => ({
          documentId,
          content: chunk.content,
          chunkIndex: chunk.index,
          tokenCount: chunk.tokenCount,
          embedding: embeddings[i],
        })),
      );
    });

    // 4. Mark document as ready and store Plate Value
    await db
      .update(kbDocuments)
      .set({
        status: 'ready',
        chunkCount: chunks.length,
        content: value as unknown,
        rawContent: storedRaw as unknown,
      })
      .where(eq(kbDocuments.id, documentId));
  } catch (error) {
    await db
      .update(kbDocuments)
      .set({
        status: 'error',
        metadata: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      })
      .where(eq(kbDocuments.id, documentId));
    throw error;
  }
}
