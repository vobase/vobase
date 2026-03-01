import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';

import { createDatabase } from './client';

type DbWithClient = ReturnType<typeof createDatabase> & { $client: Database };

const tempDbPaths = new Set<string>();

function getPragmaValue(db: DbWithClient, pragma: string): string {
  const result = db.$client.query(`PRAGMA ${pragma}`).get() as Record<
    string,
    unknown
  >;
  return String(Object.values(result)[0]);
}

function closeDatabase(db: DbWithClient): void {
  db.$client.close();
}

afterEach(() => {
  for (const dbPath of tempDbPaths) {
    rmSync(dbPath, { force: true });
  }
  tempDbPaths.clear();
});

describe('createDatabase', () => {
  it('creates an in-memory drizzle database client', () => {
    const db = createDatabase(':memory:') as DbWithClient;

    expect(db).toBeDefined();
    expect(db.$client).toBeDefined();

    closeDatabase(db);
  });

  it('sets PRAGMA busy_timeout to 5000', () => {
    const db = createDatabase(':memory:') as DbWithClient;

    expect(getPragmaValue(db, 'busy_timeout')).toBe('5000');

    closeDatabase(db);
  });

  it('sets PRAGMA synchronous to NORMAL (1)', () => {
    const db = createDatabase(':memory:') as DbWithClient;

    expect(getPragmaValue(db, 'synchronous')).toBe('1');

    closeDatabase(db);
  });

  it('sets PRAGMA foreign_keys to ON (1)', () => {
    const db = createDatabase(':memory:') as DbWithClient;

    expect(getPragmaValue(db, 'foreign_keys')).toBe('1');

    closeDatabase(db);
  });

  it('sets PRAGMA journal_mode to WAL for file databases', () => {
    const dbPath = resolve(tmpdir(), `vobase-client-${Date.now()}.db`);
    tempDbPaths.add(dbPath);
    const db = createDatabase(dbPath) as DbWithClient;

    expect(getPragmaValue(db, 'journal_mode')).toBe('wal');

    closeDatabase(db);
  });
});
