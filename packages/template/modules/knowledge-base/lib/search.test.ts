import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Database } from 'bun:sqlite';

import type { VobaseDb } from '@vobase/core';

import { createTestDb } from '../../../lib/test-helpers';

// Mock embeddings module — embedQuery returns a deterministic 4-dim vector
mock.module('./embeddings', () => ({
  embedChunks: async (texts: string[]) =>
    texts.map((_, i) => [i * 0.1, 1 - i * 0.1, 0.5, 0.5]),
  embedQuery: async (_query: string) => [0.9, 0.1, 0.5, 0.5],
}));

const { hybridSearch } = await import('./search');

describe('hybridSearch()', () => {
  let sqlite: InstanceType<typeof Database>;
  let db: VobaseDb;

  beforeEach(() => {
    const testDb = createTestDb({ withVec: true });
    sqlite = testDb.sqlite;
    db = testDb.db;

    seedTestData();
  });

  afterEach(() => {
    sqlite.close();
  });

  function seedTestData() {
    const now = Date.now();

    // Documents
    sqlite.run(
      "INSERT INTO kb_documents (id, title, source_type, mime_type, status, chunk_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ['doc-1', 'TypeScript Guide', 'upload', 'text/plain', 'ready', 2, now, now],
    );
    sqlite.run(
      "INSERT INTO kb_documents (id, title, source_type, mime_type, status, chunk_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ['doc-2', 'Python Handbook', 'upload', 'text/plain', 'ready', 1, now, now],
    );

    // Chunks
    sqlite.run(
      "INSERT INTO kb_chunks (id, row_id, document_id, content, chunk_index, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['chunk-1', 1, 'doc-1', 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.', 0, 15, now],
    );
    sqlite.run(
      "INSERT INTO kb_chunks (id, row_id, document_id, content, chunk_index, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['chunk-2', 2, 'doc-1', 'TypeScript supports interfaces, generics, and advanced type inference.', 1, 12, now],
    );
    sqlite.run(
      "INSERT INTO kb_chunks (id, row_id, document_id, content, chunk_index, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['chunk-3', 3, 'doc-2', 'Python is a dynamic programming language used for data science and web development.', 0, 16, now],
    );

    // Embeddings (vec0) — vectors close to [0.9, 0.1, 0.5, 0.5] for chunk-1, farther for others
    sqlite.run('INSERT INTO kb_embeddings (rowid, embedding) VALUES (?, ?)', [1, JSON.stringify([0.85, 0.15, 0.5, 0.5])]);
    sqlite.run('INSERT INTO kb_embeddings (rowid, embedding) VALUES (?, ?)', [2, JSON.stringify([0.6, 0.4, 0.5, 0.5])]);
    sqlite.run('INSERT INTO kb_embeddings (rowid, embedding) VALUES (?, ?)', [3, JSON.stringify([0.1, 0.9, 0.5, 0.5])]);

    // FTS5 entries
    sqlite.run('INSERT INTO kb_chunks_fts (rowid, content) VALUES (?, ?)', [1, 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.']);
    sqlite.run('INSERT INTO kb_chunks_fts (rowid, content) VALUES (?, ?)', [2, 'TypeScript supports interfaces, generics, and advanced type inference.']);
    sqlite.run('INSERT INTO kb_chunks_fts (rowid, content) VALUES (?, ?)', [3, 'Python is a dynamic programming language used for data science and web development.']);
  }

  it('returns results sorted by combined score', async () => {
    const results = await hybridSearch(db, 'TypeScript');
    expect(results.length).toBeGreaterThan(0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('returns correct result shape', async () => {
    const results = await hybridSearch(db, 'TypeScript');
    expect(results.length).toBeGreaterThan(0);

    const first = results[0];
    expect(first).toHaveProperty('chunkId');
    expect(first).toHaveProperty('documentId');
    expect(first).toHaveProperty('documentTitle');
    expect(first).toHaveProperty('content');
    expect(first).toHaveProperty('score');
    expect(first).toHaveProperty('chunkIndex');
  });

  it('ranks vector-similar chunks higher', async () => {
    // Our mock embedQuery returns [0.9, 0.1, 0.5, 0.5]
    // chunk-1 embedding [0.85, 0.15, 0.5, 0.5] is closest
    const results = await hybridSearch(db, 'anything');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunkId).toBe('chunk-1');
  });

  it('respects limit option', async () => {
    const results = await hybridSearch(db, 'TypeScript', { limit: 1 });
    expect(results.length).toBe(1);
  });

  it('returns empty array for no matches', async () => {
    sqlite.run('DELETE FROM kb_embeddings');
    sqlite.run('DELETE FROM kb_chunks_fts');
    sqlite.run('DELETE FROM kb_chunks');

    const results = await hybridSearch(db, 'nothing');
    expect(results).toEqual([]);
  });

  it('handles FTS5 special characters gracefully', async () => {
    const results = await hybridSearch(db, "what's the * (best) approach?");
    expect(Array.isArray(results)).toBe(true);
  });

  it('includes document title in results', async () => {
    const results = await hybridSearch(db, 'TypeScript');
    const tsResult = results.find((r) => r.documentId === 'doc-1');
    expect(tsResult).toBeDefined();
    expect(tsResult!.documentTitle).toBe('TypeScript Guide');
  });

  it('combines vector and keyword scores', async () => {
    const results = await hybridSearch(db, 'TypeScript');
    const tsChunks = results.filter((r) => r.documentId === 'doc-1');
    const pyChunks = results.filter((r) => r.documentId === 'doc-2');

    if (tsChunks.length > 0 && pyChunks.length > 0) {
      expect(tsChunks[0].score).toBeGreaterThan(pyChunks[0].score);
    }
  });

  it('applies custom vector/keyword weights', async () => {
    const vectorHeavy = await hybridSearch(db, 'TypeScript', {
      vectorWeight: 1.0,
      keywordWeight: 0.0,
    });
    const keywordHeavy = await hybridSearch(db, 'TypeScript', {
      vectorWeight: 0.0,
      keywordWeight: 1.0,
    });

    expect(vectorHeavy.length).toBeGreaterThan(0);
    expect(keywordHeavy.length).toBeGreaterThan(0);
  });
});
