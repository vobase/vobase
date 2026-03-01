import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';

import { ensureCoreTables } from './ensure-core-tables';

describe('ensureCoreTables', () => {
  let db: Database;

  afterEach(() => {
    db?.close();
  });

  it('creates all auth and system tables', () => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys=ON');
    ensureCoreTables(db);

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('user');
    expect(tableNames).toContain('session');
    expect(tableNames).toContain('account');
    expect(tableNames).toContain('verification');
    expect(tableNames).toContain('_audit_log');
    expect(tableNames).toContain('_sequences');
    expect(tableNames).toContain('_record_audits');
  });

  it('is idempotent — calling twice does not error', () => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys=ON');

    ensureCoreTables(db);
    ensureCoreTables(db);

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    expect(tables.length).toBeGreaterThanOrEqual(7);
  });

  it('creates indexes for session, account, and verification tables', () => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys=ON');
    ensureCoreTables(db);

    const indexes = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];

    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('session_user_id_idx');
    expect(indexNames).toContain('account_user_id_idx');
    expect(indexNames).toContain('verification_identifier_idx');
  });

  it('creates user table with correct columns and defaults', () => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys=ON');
    ensureCoreTables(db);

    const columns = db.query('PRAGMA table_info(user)').all() as {
      name: string;
      notnull: number;
      dflt_value: string | null;
    }[];

    const colMap = new Map(columns.map((c) => [c.name, c]));

    expect(colMap.get('role')?.dflt_value).toBe("'user'");
    expect(colMap.get('email_verified')?.dflt_value).toBe('0');
    expect(colMap.get('created_at')?.dflt_value).toBe(
      "strftime('%s','now') * 1000",
    );
  });

  it('enforces foreign key constraint on session.user_id', () => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys=ON');
    ensureCoreTables(db);

    expect(() => {
      db.run(
        "INSERT INTO session (id, expires_at, token, user_id) VALUES ('s1', 9999999999999, 'tok1', 'nonexistent')",
      );
    }).toThrow();
  });
});
