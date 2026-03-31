import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../../lib/test-helpers';
import { kbChunks, kbDocuments } from '../schema';
import { plateValueSchema } from './plate-types';

// Mock embeddings so tests don't require a real API key
mock.module('./embeddings', () => ({
  embedChunks: async (texts: string[]) =>
    texts.map((_, i) => [i * 0.1, 1 - i * 0.1, 0.5, 0.5]),
  embedQuery: async (_query: string) => [0.9, 0.1, 0.5, 0.5],
}));

const { migrateExistingDocuments } = await import('./migrate-content');

describe('migrateExistingDocuments()', () => {
  let db: VobaseDb;

  beforeEach(async () => {
    const testDb = await createTestDb({ withVec: true });
    db = testDb.db;
  });

  async function insertDoc(
    id: string,
    status: string,
    hasContent = false,
  ): Promise<void> {
    await db.insert(kbDocuments).values({
      id,
      title: `Doc ${id}`,
      sourceType: 'upload',
      mimeType: 'text/plain',
      status,
      content: hasContent
        ? ([{ type: 'p', children: [{ text: 'existing' }] }] as unknown)
        : null,
    });
  }

  async function insertChunks(
    documentId: string,
    texts: string[],
  ): Promise<void> {
    for (let i = 0; i < texts.length; i++) {
      await db.insert(kbChunks).values({
        documentId,
        content: texts[i],
        chunkIndex: i,
        tokenCount: Math.ceil(texts[i].length / 4),
        embedding: [i * 0.1, 0.5, 0.5, 0.5],
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Eligibility filtering
  // ---------------------------------------------------------------------------

  it('migrates ready documents with null content', async () => {
    await insertDoc('ready-1', 'ready');
    await insertChunks('ready-1', ['Some content about the topic.']);

    const count = await migrateExistingDocuments(db);
    expect(count).toBe(1);
  });

  it('skips errored documents', async () => {
    await insertDoc('error-1', 'error');
    await insertChunks('error-1', ['Content that errored.']);

    const count = await migrateExistingDocuments(db);
    expect(count).toBe(0);
  });

  it('skips pending documents', async () => {
    await insertDoc('pending-1', 'pending');
    await insertChunks('pending-1', ['Content pending processing.']);

    const count = await migrateExistingDocuments(db);
    expect(count).toBe(0);
  });

  it('skips processing documents', async () => {
    await insertDoc('processing-1', 'processing');
    await insertChunks('processing-1', ['Content being processed.']);

    const count = await migrateExistingDocuments(db);
    expect(count).toBe(0);
  });

  it('skips documents that already have content', async () => {
    await insertDoc('ready-content', 'ready', true);
    await insertChunks('ready-content', ['Already has plate value.']);

    const count = await migrateExistingDocuments(db);
    expect(count).toBe(0);
  });

  it('skips ready documents with no chunks', async () => {
    await insertDoc('no-chunks', 'ready');
    // No chunks inserted

    const count = await migrateExistingDocuments(db);
    expect(count).toBe(0);
  });

  it('processes multiple eligible documents', async () => {
    await insertDoc('multi-1', 'ready');
    await insertDoc('multi-2', 'ready');
    await insertDoc('multi-skip', 'error');
    await insertChunks('multi-1', ['Content A.', 'More content A.']);
    await insertChunks('multi-2', ['Content B.']);

    const count = await migrateExistingDocuments(db);
    expect(count).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Content validity
  // ---------------------------------------------------------------------------

  it('backfilled content passes plateValueSchema validation', async () => {
    await insertDoc('schema-1', 'ready');
    await insertChunks('schema-1', [
      '# Heading\n\nSome paragraph text here.',
      'Another paragraph with more text.',
    ]);

    await migrateExistingDocuments(db);

    const [doc] = await db
      .select({ content: kbDocuments.content })
      .from(kbDocuments)
      .where(eq(kbDocuments.id, 'schema-1'));

    const result = plateValueSchema.safeParse(doc?.content);
    expect(result.success).toBe(true);
  });

  it('backfills both content and rawContent', async () => {
    await insertDoc('both-cols', 'ready');
    await insertChunks('both-cols', ['Paragraph one.', 'Paragraph two.']);

    await migrateExistingDocuments(db);

    const [doc] = await db
      .select({
        content: kbDocuments.content,
        rawContent: kbDocuments.rawContent,
      })
      .from(kbDocuments)
      .where(eq(kbDocuments.id, 'both-cols'));

    expect(Array.isArray(doc?.content)).toBe(true);
    expect(Array.isArray(doc?.rawContent)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // reembed flag
  // ---------------------------------------------------------------------------

  it('does NOT re-embed when reembed is false (default)', async () => {
    await insertDoc('no-reembed', 'ready');
    await insertChunks('no-reembed', ['Content for no-reembed test.']);

    const before = await db
      .select({ content: kbChunks.content, embedding: kbChunks.embedding })
      .from(kbChunks)
      .where(eq(kbChunks.documentId, 'no-reembed'));

    await migrateExistingDocuments(db, { reembed: false });

    const after = await db
      .select({ content: kbChunks.content, embedding: kbChunks.embedding })
      .from(kbChunks)
      .where(eq(kbChunks.documentId, 'no-reembed'));

    // Chunk count should be unchanged
    expect(after).toHaveLength(before.length);
    // Original chunk content preserved
    expect(after[0]?.content).toBe(before[0]?.content);
  });

  it('re-embeds and re-chunks when reembed is true', async () => {
    await insertDoc('with-reembed', 'ready');
    await insertChunks('with-reembed', [
      'First chunk of content for reembed test.',
      'Second chunk of content for reembed test.',
    ]);

    await migrateExistingDocuments(db, { reembed: true });

    const [doc] = await db
      .select({ content: kbDocuments.content, status: kbDocuments.status })
      .from(kbDocuments)
      .where(eq(kbDocuments.id, 'with-reembed'));

    // Document should still be ready after re-processing
    expect(doc?.status).toBe('ready');
    // Content should be set as Plate Value
    expect(Array.isArray(doc?.content)).toBe(true);
  });
});
