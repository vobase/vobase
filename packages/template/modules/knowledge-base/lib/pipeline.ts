import { eq } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';

import type { VobaseDb } from '@vobase/core';

import { kbDocuments } from '../schema';
import { recursiveChunk } from './chunker';
import { embedChunks } from './embeddings';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

/**
 * Process a document: chunk → embed → store in Drizzle + vec0 + FTS5.
 * Updates the document status through the pipeline.
 */
export async function processDocument(db: VobaseDb, documentId: string, content: string): Promise<void> {
  // Mark as processing
  await db.update(kbDocuments).set({ status: 'processing' }).where(eq(kbDocuments.id, documentId));

  try {
    // 1. Chunk the content
    const chunks = recursiveChunk(content);
    if (chunks.length === 0) {
      await db.update(kbDocuments).set({ status: 'ready', chunkCount: 0 }).where(eq(kbDocuments.id, documentId));
      return;
    }

    // 2. Generate embeddings for all chunks
    const embeddings = await embedChunks(chunks.map((c) => c.content));

    // 3. Insert chunks + embeddings + FTS5 entries inside a transaction
    //    to avoid TOCTOU race on rowId assignment.
    const raw = db.$client;
    const insertChunk = raw.prepare(
      `INSERT INTO kb_chunks (id, row_id, document_id, content, chunk_index, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertEmbedding = raw.prepare(`INSERT INTO kb_embeddings (rowid, embedding) VALUES (?, ?)`);
    const insertFts = raw.prepare(`INSERT INTO kb_chunks_fts (rowid, content) VALUES (?, ?)`);

    raw.run('BEGIN IMMEDIATE');
    try {
      const maxRowResult = raw.prepare('SELECT COALESCE(MAX(row_id), 0) as max_id FROM kb_chunks').get() as {
        max_id: number;
      };
      let nextRowId = maxRowResult.max_id + 1;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const rowId = nextRowId++;
        const id = nanoid(12);

        insertChunk.run(id, rowId, documentId, chunk.content, chunk.index, chunk.tokenCount, Date.now());
        insertEmbedding.run(rowId, JSON.stringify(embeddings[i]));
        insertFts.run(rowId, chunk.content);
      }

      raw.run('COMMIT');
    } catch (txError) {
      raw.run('ROLLBACK');
      throw txError;
    }

    // 5. Mark document as ready
    await db.update(kbDocuments).set({ status: 'ready', chunkCount: chunks.length }).where(eq(kbDocuments.id, documentId));
  } catch (error) {
    // Mark as error
    await db
      .update(kbDocuments)
      .set({
        status: 'error',
        metadata: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      })
      .where(eq(kbDocuments.id, documentId));
    throw error;
  }
}
