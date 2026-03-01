import type { Database } from 'bun:sqlite';

/**
 * Ensures all core framework tables exist in the database.
 *
 * Creates auth tables (user, session, account, verification) and system tables
 * (_audit_log, _sequences, _record_audits) using idempotent CREATE TABLE IF NOT EXISTS.
 *
 * This runs before Drizzle migrations so that core tables are always available
 * regardless of the user project's migration state.
 */
export function ensureCoreTables(db: Database): void {
  db.exec(CORE_TABLES_SQL);
}

/**
 * Inline SQL for all core framework tables.
 * Uses SQLite-specific DEFAULT expressions for timestamps (epoch milliseconds).
 * All statements are idempotent (CREATE TABLE/INDEX IF NOT EXISTS).
 */
const CORE_TABLES_SQL = `
-- Auth tables (managed by better-auth via Drizzle adapter)

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS session_user_id_idx ON session(user_id);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS account_user_id_idx ON account(user_id);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);

-- System tables (audit log, sequences, record audits)

CREATE TABLE IF NOT EXISTS _audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  event TEXT NOT NULL,
  actor_id TEXT,
  actor_email TEXT,
  ip TEXT,
  details TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS _sequences (
  id TEXT PRIMARY KEY NOT NULL,
  prefix TEXT NOT NULL UNIQUE,
  current_value INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS _record_audits (
  id TEXT PRIMARY KEY NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  old_data TEXT,
  new_data TEXT,
  changed_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
`;
