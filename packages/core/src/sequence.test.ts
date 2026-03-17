import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import type { VobaseDb } from './db';
import { nextSequence } from './modules/sequences/next-sequence';
import * as schema from './modules/sequences/schema';

describe('nextSequence()', () => {
  let pglite: PGlite;
  let db: VobaseDb;

  beforeEach(async () => {
    pglite = new PGlite();
    await pglite.exec(`
      CREATE TABLE _sequences (
        id TEXT PRIMARY KEY NOT NULL,
        prefix TEXT NOT NULL UNIQUE,
        current_value INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    db = drizzle({ client: pglite, schema }) as unknown as VobaseDb;
  });

  afterEach(async () => {
    await pglite.close();
  });

  it('returns gap-free numbers for same prefix', async () => {
    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await nextSequence(db, 'INV'));
    }
    expect(results).toEqual([
      'INV-0001',
      'INV-0002',
      'INV-0003',
      'INV-0004',
      'INV-0005',
    ]);
  });

  it('maintains independent counters per prefix', async () => {
    expect(await nextSequence(db, 'INV')).toBe('INV-0001');
    expect(await nextSequence(db, 'ORD')).toBe('ORD-0001');
    expect(await nextSequence(db, 'INV')).toBe('INV-0002');
    expect(await nextSequence(db, 'ORD')).toBe('ORD-0002');
  });

  it('formats sequence with year prefix when enabled', async () => {
    const year = new Date().getFullYear();
    expect(await nextSequence(db, 'INV', { yearPrefix: true })).toBe(
      `INV-${year}-0001`,
    );
  });
});
