import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { eq } from 'drizzle-orm';

import type { VobaseDb } from '@vobase/core';

import { createTestDb } from '../../../lib/test-helpers';
import { kbDocuments, kbChunks } from '../schema';

// Mock embeddings to return deterministic 4-dim vectors
mock.module('./embeddings', () => ({
  embedChunks: async (texts: string[]) =>
    texts.map((_, i) => [i * 0.1, 1 - i * 0.1, 0.5, 0.5]),
  embedQuery: async (_query: string) => [0.9, 0.1, 0.5, 0.5],
}));

// Re-import after mocking
const { processDocument } = await import('./pipeline');

describe('processDocument()', () => {
  let sqlite: InstanceType<typeof Database>;
  let db: VobaseDb;

  beforeEach(() => {
    const testDb = createTestDb({ withVec: true });
    sqlite = testDb.sqlite;
    db = testDb.db;
  });

  afterEach(() => {
    sqlite.close();
  });

  async function insertDoc(id: string, title: string) {
    await db.insert(kbDocuments).values({
      id,
      title,
      sourceType: 'upload',
      mimeType: 'text/plain',
      status: 'pending',
    });
  }

  it('marks document as ready after processing', async () => {
    await insertDoc('doc-1', 'Test Doc');
    await processDocument(db, 'doc-1', 'Some short content.');

    const doc = await db.select().from(kbDocuments).where(eq(kbDocuments.id, 'doc-1')).get();
    expect(doc!.status).toBe('ready');
  });

  it('sets chunkCount to 0 for empty content', async () => {
    await insertDoc('doc-2', 'Empty Doc');
    await processDocument(db, 'doc-2', '');

    const doc = await db.select().from(kbDocuments).where(eq(kbDocuments.id, 'doc-2')).get();
    expect(doc!.status).toBe('ready');
    expect(doc!.chunkCount).toBe(0);
  });

  it('creates chunks in the database', async () => {
    await insertDoc('doc-3', 'Chunked Doc');
    await processDocument(db, 'doc-3', 'This is a piece of content that will become a chunk.');

    const chunks = await db.select().from(kbChunks).where(eq(kbChunks.documentId, 'doc-3'));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toBeTruthy();
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].rowId).toBe(1);
  });

  it('inserts embeddings into vec0 virtual table', async () => {
    await insertDoc('doc-4', 'Vector Doc');
    await processDocument(db, 'doc-4', 'Content for vector embedding.');

    const rows = sqlite.prepare('SELECT rowid FROM kb_embeddings').all();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('inserts content into FTS5 virtual table', async () => {
    await insertDoc('doc-5', 'FTS Doc');
    await processDocument(db, 'doc-5', 'Searchable full text content here.');

    const rows = sqlite
      .prepare("SELECT rowid FROM kb_chunks_fts WHERE kb_chunks_fts MATCH 'searchable'")
      .all();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('assigns sequential rowIds across multiple documents', async () => {
    await insertDoc('doc-6a', 'First');
    await processDocument(db, 'doc-6a', 'First document content.');

    await insertDoc('doc-6b', 'Second');
    await processDocument(db, 'doc-6b', 'Second document content.');

    const allChunks = await db.select().from(kbChunks);
    const rowIds = allChunks.map((c) => c.rowId).sort((a, b) => a - b);
    // Verify sequential, no gaps
    for (let i = 1; i < rowIds.length; i++) {
      expect(rowIds[i]).toBe(rowIds[i - 1] + 1);
    }
  });

  it('marks document as error on failure', async () => {
    await insertDoc('doc-7', 'Bad Doc');

    // Mock embedChunks to throw for this specific test
    const origModule = await import('./embeddings');
    const origFn = origModule.embedChunks;
    mock.module('./embeddings', () => ({
      embedChunks: async () => {
        throw new Error('API key invalid');
      },
    }));

    // Re-import to get the version with the throwing mock
    const { processDocument: processWithError } = await import('./pipeline');

    try {
      await processWithError(db, 'doc-7', 'Content that will fail.');
    } catch {
      // expected
    }

    const doc = await db.select().from(kbDocuments).where(eq(kbDocuments.id, 'doc-7')).get();
    expect(doc!.status).toBe('error');
    expect(doc!.metadata).toContain('API key invalid');

    // Restore original mock
    mock.module('./embeddings', () => ({
      embedChunks: origFn,
    }));
  });

  it('updates document chunkCount correctly', async () => {
    await insertDoc('doc-8', 'Counted Doc');
    await processDocument(db, 'doc-8', 'A short piece of text.');

    const doc = await db.select().from(kbDocuments).where(eq(kbDocuments.id, 'doc-8')).get();
    const chunks = await db.select().from(kbChunks).where(eq(kbChunks.documentId, 'doc-8'));
    expect(doc!.chunkCount).toBe(chunks.length);
  });
});
