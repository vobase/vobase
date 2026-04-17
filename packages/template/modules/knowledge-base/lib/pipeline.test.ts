import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../../lib/test-helpers';
import { kbChunks, kbDocuments } from '../schema';
import type { PlateValue } from './plate-types';
import { createParagraph, createText } from './plate-types';

// Mock embeddings to return deterministic 4-dim vectors
mock.module('../../../lib/embeddings', () => ({
  embedChunks: async (texts: string[]) =>
    texts.map((_, i) => [i * 0.1, 1 - i * 0.1, 0.5, 0.5]),
  embedQuery: async (_query: string) => [0.9, 0.1, 0.5, 0.5],
}));

// Re-import after mocking
const { processDocument } = await import('./pipeline');

/** Helper: wrap a plain string into a minimal PlateValue */
function textPlate(text: string): PlateValue {
  return [createParagraph([createText(text)])];
}

/** Empty PlateValue (single empty paragraph — filters to 0 chunks) */
const EMPTY_PLATE: PlateValue = [createParagraph()];

describe('processDocument()', () => {
  let pglite: PGlite;
  let db: VobaseDb;

  beforeEach(async () => {
    const testDb = await createTestDb({ withVec: true });
    pglite = testDb.pglite;
    db = testDb.db;
  });

  // Singleton PGlite — never close; process exit handles cleanup

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
    await processDocument(db, 'doc-1', textPlate('Some short content.'));

    const [doc] = await db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.id, 'doc-1'));
    expect(doc?.status).toBe('ready');
  });

  it('sets chunkCount to 0 for empty content', async () => {
    await insertDoc('doc-2', 'Empty Doc');
    await processDocument(db, 'doc-2', EMPTY_PLATE);

    const [doc] = await db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.id, 'doc-2'));
    expect(doc?.status).toBe('ready');
    expect(doc?.chunkCount).toBe(0);
  });

  it('creates chunks in the database', async () => {
    await insertDoc('doc-3', 'Chunked Doc');
    await processDocument(
      db,
      'doc-3',
      textPlate('This is a piece of content that will become a chunk.'),
    );

    const chunks = await db
      .select()
      .from(kbChunks)
      .where(eq(kbChunks.documentId, 'doc-3'));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toBeTruthy();
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it('stores embeddings inline in kb_chunks', async () => {
    await insertDoc('doc-4', 'Vector Doc');
    await processDocument(
      db,
      'doc-4',
      textPlate('Content for vector embedding.'),
    );

    const result = await pglite.query<{ id: string }>(
      'SELECT id FROM "kb"."chunks" WHERE embedding IS NOT NULL AND document_id = $1',
      ['doc-4'],
    );
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('generates tsvector for full-text search', async () => {
    await insertDoc('doc-5', 'FTS Doc');
    await processDocument(
      db,
      'doc-5',
      textPlate('Searchable full text content here.'),
    );

    const result = await pglite.query<{ id: string }>(
      'SELECT id FROM "kb"."chunks" WHERE search_vector @@ to_tsquery(\'english\', \'searchable\') AND document_id = $1',
      ['doc-5'],
    );
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('assigns chunkIndex starting at 0', async () => {
    await insertDoc('doc-6', 'Indexed Doc');
    await processDocument(db, 'doc-6', textPlate('First chunk content.'));

    const chunks = await db
      .select()
      .from(kbChunks)
      .where(eq(kbChunks.documentId, 'doc-6'));
    if (chunks.length > 0) {
      const indices = chunks.map((c) => c.chunkIndex).sort((a, b) => a - b);
      expect(indices[0]).toBe(0);
    }
  });

  it('marks document as error on failure', async () => {
    await insertDoc('doc-7', 'Bad Doc');

    // Mock embedChunks to throw for this specific test
    const origModule = await import('../../../lib/embeddings');
    const origFn = origModule.embedChunks;
    mock.module('../../../lib/embeddings', () => ({
      embedChunks: async () => {
        throw new Error('API key invalid');
      },
    }));

    // Re-import to get the version with the throwing mock
    const { processDocument: processWithError } = await import('./pipeline');

    try {
      await processWithError(db, 'doc-7', textPlate('Content that will fail.'));
    } catch {
      // expected
    }

    const [doc] = await db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.id, 'doc-7'));
    expect(doc?.status).toBe('error');
    expect(doc?.metadata).toContain('API key invalid');

    // Restore original mock
    mock.module('../../../lib/embeddings', () => ({
      embedChunks: origFn,
    }));
  });

  it('updates document chunkCount correctly', async () => {
    await insertDoc('doc-8', 'Counted Doc');
    await processDocument(db, 'doc-8', textPlate('A short piece of text.'));

    const [doc] = await db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.id, 'doc-8'));
    const chunks = await db
      .select()
      .from(kbChunks)
      .where(eq(kbChunks.documentId, 'doc-8'));
    expect(doc?.chunkCount).toBe(chunks.length);
  });

  it('stores content and rawContent as jsonb on the document', async () => {
    await insertDoc('doc-9', 'Plate Doc');
    const value = textPlate('Stored as jsonb.');
    await processDocument(db, 'doc-9', value, value);

    const [doc] = await db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.id, 'doc-9'));
    expect(doc?.content).toBeTruthy();
    expect(Array.isArray(doc?.content)).toBe(true);
    expect(doc?.rawContent).toBeTruthy();
  });
});
