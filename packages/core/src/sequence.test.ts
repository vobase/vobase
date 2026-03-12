import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import type { VobaseDb } from './db';
import * as schema from './modules/sequences/schema';
import { nextSequence } from './modules/sequences/next-sequence';

describe('nextSequence()', () => {
  let sqlite: Database;
  let db: VobaseDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.run('PRAGMA journal_mode=WAL');
    sqlite.exec(`
      CREATE TABLE _sequences (
        id TEXT PRIMARY KEY,
        prefix TEXT NOT NULL UNIQUE,
        current_value INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `);

    db = drizzle({ client: sqlite, schema }) as unknown as VobaseDb;
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns gap-free numbers for same prefix', () => {
    const values = Array.from({ length: 5 }, () => nextSequence(db, 'INV'));
    expect(values).toEqual([
      'INV-0001',
      'INV-0002',
      'INV-0003',
      'INV-0004',
      'INV-0005',
    ]);
  });

  it('maintains independent counters per prefix', () => {
    expect(nextSequence(db, 'INV')).toBe('INV-0001');
    expect(nextSequence(db, 'ORD')).toBe('ORD-0001');
    expect(nextSequence(db, 'INV')).toBe('INV-0002');
    expect(nextSequence(db, 'ORD')).toBe('ORD-0002');
  });

  it('formats sequence with year prefix when enabled', () => {
    const year = new Date().getFullYear();
    expect(nextSequence(db, 'INV', { yearPrefix: true })).toBe(
      `INV-${year}-0001`,
    );
  });
});
