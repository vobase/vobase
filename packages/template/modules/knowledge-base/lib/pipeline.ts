import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { kbChunks, kbDocuments } from '../schema';
import { recursiveChunk } from './chunker';
import { embedChunks } from './embeddings';

/**
 * Process a document: chunk → embed → store in kbChunks.
 * searchVector (tsvector) is generated automatically by PostgreSQL.
 * Updates the document status through the pipeline.
 */
export async function processDocument(
  db: VobaseDb,
  documentId: string,
  content: string,
): Promise<void> {
  // Mark as processing
  await db
    .update(kbDocuments)
    .set({ status: 'processing' })
    .where(eq(kbDocuments.id, documentId));

  try {
    // 1. Chunk the content
    const chunks = recursiveChunk(content);
    if (chunks.length === 0) {
      await db
        .update(kbDocuments)
        .set({ status: 'ready', chunkCount: 0 })
        .where(eq(kbDocuments.id, documentId));
      return;
    }

    // 2. Generate embeddings for all chunks
    const embeddings = await embedChunks(chunks.map((c) => c.content));

    // 3. Insert chunks with embeddings in a transaction
    //    PostgreSQL automatically populates searchVector via generatedAlwaysAs.
    await db.transaction(async (tx) => {
      for (let i = 0; i < chunks.length; i++) {
        await tx.insert(kbChunks).values({
          documentId,
          content: chunks[i].content,
          chunkIndex: chunks[i].index,
          tokenCount: chunks[i].tokenCount,
          embedding: embeddings[i],
        });
      }
    });

    // 4. Mark document as ready
    await db
      .update(kbDocuments)
      .set({ status: 'ready', chunkCount: chunks.length })
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
