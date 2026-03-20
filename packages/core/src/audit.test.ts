import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import { createTestPGlite } from './test-helpers';

import type { VobaseDb } from './db';
import * as schema from './modules/audit/schema';
import { trackChanges } from './modules/audit/track-changes';

interface AuditRow {
  tableName: string;
  recordId: string;
  oldData: string | null;
  newData: string | null;
  changedBy: string | null;
}

describe('trackChanges()', () => {
  let pglite: PGlite;
  let db: VobaseDb;

  beforeEach(async () => {
    pglite = await createTestPGlite();
    await pglite.query(`
      CREATE TABLE _record_audits (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        old_data TEXT,
        new_data TEXT,
        changed_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    db = drizzle({ client: pglite, schema }) as unknown as VobaseDb;
  });

  afterEach(async () => {
    await pglite.close();
  });

  async function getRows(): Promise<AuditRow[]> {
    const result = await pglite.query<AuditRow>(`
      SELECT
        table_name AS "tableName",
        record_id AS "recordId",
        old_data AS "oldData",
        new_data AS "newData",
        changed_by AS "changedBy"
      FROM _record_audits
      ORDER BY created_at ASC
    `);
    return result.rows;
  }

  it('stores full new data for create events', async () => {
    await trackChanges(
      db,
      'invoices',
      'inv_1',
      null,
      { status: 'draft', total: 100 },
      'user_1',
    );

    const rows = await getRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      tableName: 'invoices',
      recordId: 'inv_1',
      oldData: null,
      newData: JSON.stringify({ status: 'draft', total: 100 }),
      changedBy: 'user_1',
    });
  });

  it('stores only changed fields for update events', async () => {
    await trackChanges(
      db,
      'invoices',
      'inv_2',
      { status: 'draft', total: 100, note: 'A' },
      { status: 'sent', total: 100, note: 'B' },
      'user_2',
    );

    const rows = await getRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.oldData).toBe(
      JSON.stringify({ status: 'draft', note: 'A' }),
    );
    expect(rows[0]?.newData).toBe(
      JSON.stringify({ status: 'sent', note: 'B' }),
    );
    expect(rows[0]?.changedBy).toBe('user_2');
  });

  it('stores full old data for delete events', async () => {
    await trackChanges(
      db,
      'invoices',
      'inv_3',
      { status: 'void', total: 20 },
      null,
    );

    const rows = await getRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.oldData).toBe(
      JSON.stringify({ status: 'void', total: 20 }),
    );
    expect(rows[0]?.newData).toBeNull();
    expect(rows[0]?.changedBy).toBeNull();
  });

  it('does not store an audit row when values are unchanged', async () => {
    await trackChanges(
      db,
      'invoices',
      'inv_4',
      { status: 'draft', total: 100 },
      { status: 'draft', total: 100 },
      'user_3',
    );

    expect(await getRows()).toHaveLength(0);
  });
});
