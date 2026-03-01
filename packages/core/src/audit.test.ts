import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import type { VobaseDb } from './db';
import * as schema from './db/system-schema';
import { trackChanges } from './audit';

interface AuditRow {
  tableName: string;
  recordId: string;
  oldData: string | null;
  newData: string | null;
  changedBy: string | null;
}

describe('trackChanges()', () => {
  let sqlite: Database;
  let db: VobaseDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.run('PRAGMA journal_mode=WAL');
    sqlite.exec(`
      CREATE TABLE _record_audits (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        old_data TEXT,
        new_data TEXT,
        changed_by TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    db = drizzle(sqlite, { schema }) as unknown as VobaseDb;
  });

  afterEach(() => {
    sqlite.close();
  });

  function getRows(): AuditRow[] {
    return sqlite
      .prepare(
        `
          SELECT
            table_name AS tableName,
            record_id AS recordId,
            old_data AS oldData,
            new_data AS newData,
            changed_by AS changedBy
          FROM _record_audits
          ORDER BY rowid ASC
        `
      )
      .all() as AuditRow[];
  }

  it('stores full new data for create events', () => {
    trackChanges(db, 'invoices', 'inv_1', null, { status: 'draft', total: 100 }, 'user_1');

    const rows = getRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      tableName: 'invoices',
      recordId: 'inv_1',
      oldData: null,
      newData: JSON.stringify({ status: 'draft', total: 100 }),
      changedBy: 'user_1',
    });
  });

  it('stores only changed fields for update events', () => {
    trackChanges(
      db,
      'invoices',
      'inv_2',
      { status: 'draft', total: 100, note: 'A' },
      { status: 'sent', total: 100, note: 'B' },
      'user_2'
    );

    const rows = getRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.oldData).toBe(JSON.stringify({ status: 'draft', note: 'A' }));
    expect(rows[0]?.newData).toBe(JSON.stringify({ status: 'sent', note: 'B' }));
    expect(rows[0]?.changedBy).toBe('user_2');
  });

  it('stores full old data for delete events', () => {
    trackChanges(db, 'invoices', 'inv_3', { status: 'void', total: 20 }, null);

    const rows = getRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.oldData).toBe(JSON.stringify({ status: 'void', total: 20 }));
    expect(rows[0]?.newData).toBeNull();
    expect(rows[0]?.changedBy).toBeNull();
  });

  it('does not store an audit row when values are unchanged', () => {
    trackChanges(
      db,
      'invoices',
      'inv_4',
      { status: 'draft', total: 100 },
      { status: 'draft', total: 100 },
      'user_3'
    );

    expect(getRows()).toHaveLength(0);
  });
});
