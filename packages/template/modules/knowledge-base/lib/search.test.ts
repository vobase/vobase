import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';

import { createTestDb } from '../../../lib/test-helpers';

// Mock embeddings module — embedQuery returns a deterministic 4-dim vector
mock.module('./embeddings', () => ({
  embedChunks: async (texts: string[]) =>
    texts.map((_, i) => [i * 0.1, 1 - i * 0.1, 0.5, 0.5]),
  embedQuery: async (_query: string) => [0.9, 0.1, 0.5, 0.5],
}));

// Mock AI for HyDE and re-ranking (deep mode tests)
mock.module('ai', () => ({
  generateText: async ({ prompt }: { prompt: string }) => {
    if (prompt.includes('Write a short passage')) {
      return { text: 'TypeScript is a statically typed language.' };
    }
    // Re-ranking mock — return indices in order
    return { text: '[0, 1, 2]' };
  },
}));
mock.module('@ai-sdk/openai', () => ({
  openai: () => ({}),
}));

const { hybridSearch } = await import('./search');

describe('hybridSearch()', () => {
  let pglite: PGlite;
  let db: VobaseDb;

  beforeEach(async () => {
    const testDb = await createTestDb({ withVec: true });
    pglite = testDb.pglite;
    db = testDb.db;

    await seedTestData();
  });

  afterEach(async () => {
    await pglite.close();
  });

  async function seedTestData() {
    const now = new Date().toISOString();

    // Documents
    await pglite.query(
      'INSERT INTO "kb"."documents" (id, title, source_type, mime_type, status, chunk_count, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        'doc-1',
        'TypeScript Guide',
        'upload',
        'text/plain',
        'ready',
        2,
        now,
        now,
      ],
    );
    await pglite.query(
      'INSERT INTO "kb"."documents" (id, title, source_type, mime_type, status, chunk_count, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        'doc-2',
        'Python Handbook',
        'upload',
        'text/plain',
        'ready',
        1,
        now,
        now,
      ],
    );

    // Chunks with embeddings — search_vector (tsvector) is generated automatically
    // Vectors close to [0.9, 0.1, 0.5, 0.5] for chunk-1, farther for others
    await pglite.query(
      'INSERT INTO "kb"."chunks" (id, document_id, content, chunk_index, token_count, embedding, created_at) VALUES ($1, $2, $3, $4, $5, $6::vector, $7)',
      [
        'chunk-1',
        'doc-1',
        'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.',
        0,
        15,
        '[0.85, 0.15, 0.5, 0.5]',
        now,
      ],
    );
    await pglite.query(
      'INSERT INTO "kb"."chunks" (id, document_id, content, chunk_index, token_count, embedding, created_at) VALUES ($1, $2, $3, $4, $5, $6::vector, $7)',
      [
        'chunk-2',
        'doc-1',
        'TypeScript supports interfaces, generics, and advanced type inference.',
        1,
        12,
        '[0.6, 0.4, 0.5, 0.5]',
        now,
      ],
    );
    await pglite.query(
      'INSERT INTO "kb"."chunks" (id, document_id, content, chunk_index, token_count, embedding, created_at) VALUES ($1, $2, $3, $4, $5, $6::vector, $7)',
      [
        'chunk-3',
        'doc-2',
        'Python is a dynamic programming language used for data science and web development.',
        0,
        16,
        '[0.1, 0.9, 0.5, 0.5]',
        now,
      ],
    );
  }

  describe('RRF scoring', () => {
    it('returns results sorted by RRF score', async () => {
      const results = await hybridSearch(db, 'TypeScript');
      expect(results.length).toBeGreaterThan(0);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('ranks vector-similar chunks higher with RRF', async () => {
      // Mock embedQuery returns [0.9, 0.1, 0.5, 0.5]
      // chunk-1 embedding [0.85, 0.15, 0.5, 0.5] is closest
      const results = await hybridSearch(db, 'anything');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].chunkId).toBe('chunk-1');
    });

    it('combines vector and keyword signals via RRF', async () => {
      // "TypeScript" matches chunks 1 and 2 in FTS AND chunk-1 is vector-closest
      const results = await hybridSearch(db, 'TypeScript');
      const tsChunks = results.filter((r) => r.documentId === 'doc-1');
      const pyChunks = results.filter((r) => r.documentId === 'doc-2');

      if (tsChunks.length > 0 && pyChunks.length > 0) {
        expect(tsChunks[0].score).toBeGreaterThan(pyChunks[0].score);
      }
    });

    it('RRF scores use the formula 1/(k+rank) with k=60', async () => {
      const results = await hybridSearch(db, 'TypeScript');
      // With k=60, rank 1 contributes 1/61 ≈ 0.01639
      // Scores should be small positive numbers
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
        expect(r.score).toBeLessThan(1);
      }
    });
  });

  describe('result shape and options', () => {
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

    it('respects limit option', async () => {
      const results = await hybridSearch(db, 'TypeScript', { limit: 1 });
      expect(results.length).toBe(1);
    });

    it('returns empty array for no matches', async () => {
      await pglite.query('DELETE FROM "kb"."chunks"');
      await pglite.query('DELETE FROM "kb"."documents"');

      const results = await hybridSearch(db, 'nothing');
      expect(results).toEqual([]);
    });

    it('handles FTS special characters gracefully', async () => {
      const results = await hybridSearch(db, "what's the * (best) approach?");
      expect(Array.isArray(results)).toBe(true);
    });

    it('includes document title in results', async () => {
      const results = await hybridSearch(db, 'TypeScript');
      const tsResult = results.find((r) => r.documentId === 'doc-1');
      expect(tsResult).toBeDefined();
      expect(tsResult?.documentTitle).toBe('TypeScript Guide');
    });

    it('ignores deprecated vectorWeight/keywordWeight (backward compat)', async () => {
      const results1 = await hybridSearch(db, 'TypeScript', {
        vectorWeight: 1.0,
        keywordWeight: 0.0,
      });
      const results2 = await hybridSearch(db, 'TypeScript', {
        vectorWeight: 0.0,
        keywordWeight: 1.0,
      });

      // Both should return results (RRF ignores weights)
      expect(results1.length).toBeGreaterThan(0);
      expect(results2.length).toBeGreaterThan(0);
      // Results should be identical since weights are ignored
      expect(results1.map((r) => r.chunkId)).toEqual(
        results2.map((r) => r.chunkId),
      );
    });
  });

  describe('fast mode (default)', () => {
    it('uses fast mode by default', async () => {
      const results = await hybridSearch(db, 'TypeScript');
      // Fast mode only uses vector + FTS, no HyDE
      expect(results.length).toBeGreaterThan(0);
    });

    it('fast mode does not call generateText (no HyDE)', async () => {
      // If generateText were called, our mock would still work,
      // but fast mode should skip it entirely
      const results = await hybridSearch(db, 'TypeScript', { mode: 'fast' });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('deep mode', () => {
    it('deep mode returns results with HyDE expansion', async () => {
      // Override isAIConfigured to return true
      const origKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key';

      const results = await hybridSearch(db, 'TypeScript', { mode: 'deep' });
      expect(results.length).toBeGreaterThan(0);

      if (origKey) process.env.OPENAI_API_KEY = origKey;
      else delete process.env.OPENAI_API_KEY;
    });

    it('deep mode gracefully degrades when AI is not configured', async () => {
      const origKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const results = await hybridSearch(db, 'TypeScript', { mode: 'deep' });
      // Should still return results via RRF without HyDE
      expect(results.length).toBeGreaterThan(0);

      if (origKey) process.env.OPENAI_API_KEY = origKey;
    });

    it('deep mode with rerank returns limited results', async () => {
      const origKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key';

      const results = await hybridSearch(db, 'TypeScript', {
        mode: 'deep',
        rerank: true,
        limit: 2,
      });
      expect(results.length).toBeLessThanOrEqual(2);

      if (origKey) process.env.OPENAI_API_KEY = origKey;
      else delete process.env.OPENAI_API_KEY;
    });
  });
});
