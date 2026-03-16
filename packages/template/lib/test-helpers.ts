import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { VobaseDb } from '@vobase/core';
import * as kbSchema from '../modules/knowledge-base/schema';
import * as messagingSchema from '../modules/messaging/schema';

const CUSTOM_SQLITE = '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib';
const VEC_EXTENSION_PATH =
  '/Users/carl/vobase/node_modules/.bun/sqlite-vec-darwin-arm64@0.1.7-alpha.2/node_modules/sqlite-vec-darwin-arm64/vec0';

let customSqliteSet = false;

/**
 * Create an in-memory test database with KB and messaging tables.
 * Returns both the raw SQLite handle and the Drizzle wrapper.
 */
export function createTestDb(options?: { withVec?: boolean }) {
  if (!customSqliteSet) {
    try {
      Database.setCustomSQLite(CUSTOM_SQLITE);
    } catch {
      // May already be set
    }
    customSqliteSet = true;
  }

  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA journal_mode=WAL');

  // Create KB tables
  sqlite.run(`
    CREATE TABLE kb_documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'upload',
      source_id TEXT,
      source_url TEXT,
      mime_type TEXT NOT NULL DEFAULT 'text/plain',
      status TEXT NOT NULL DEFAULT 'pending',
      chunk_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  sqlite.run(`
    CREATE TABLE kb_chunks (
      id TEXT PRIMARY KEY,
      row_id INTEGER NOT NULL UNIQUE,
      document_id TEXT NOT NULL,
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  sqlite.run(`
    CREATE TABLE kb_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT,
      sync_schedule TEXT,
      last_sync_at INTEGER,
      status TEXT NOT NULL DEFAULT 'idle',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  sqlite.run(`
    CREATE TABLE kb_sync_logs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL,
      documents_processed INTEGER NOT NULL DEFAULT 0,
      errors TEXT,
      started_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      completed_at INTEGER
    )
  `);

  // Create messaging tables
  sqlite.run(`
    CREATE TABLE msg_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,
      system_prompt TEXT,
      tools TEXT,
      kb_source_ids TEXT,
      model TEXT,
      suggestions TEXT,
      channels TEXT,
      user_id TEXT NOT NULL,
      is_published INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  sqlite.run(`
    CREATE TABLE msg_threads (
      id TEXT PRIMARY KEY,
      title TEXT,
      agent_id TEXT,
      user_id TEXT,
      contact_id TEXT,
      channel TEXT NOT NULL DEFAULT 'web',
      status TEXT NOT NULL DEFAULT 'ai',
      ai_paused_at INTEGER,
      ai_resume_at INTEGER,
      window_expires_at INTEGER,
      archived_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  sqlite.run(`
    CREATE TABLE msg_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'inbound',
      sender_type TEXT NOT NULL DEFAULT 'user',
      ai_role TEXT,
      content TEXT,
      tool_calls TEXT,
      tool_results TEXT,
      sources TEXT,
      attachments TEXT,
      external_message_id TEXT UNIQUE,
      status TEXT DEFAULT 'sent',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  sqlite.run(`
    CREATE TABLE msg_contacts (
      id TEXT PRIMARY KEY,
      phone TEXT UNIQUE,
      email TEXT UNIQUE,
      name TEXT,
      channel TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  // Load sqlite-vec and create virtual tables if requested
  if (options?.withVec) {
    sqlite.loadExtension(VEC_EXTENSION_PATH);
    sqlite.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_embeddings USING vec0(
        rowid INTEGER PRIMARY KEY,
        embedding float[4]
      )
    `);
    sqlite.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
        content,
        content_rowid='rowid'
      )
    `);
  }

  const schema = { ...kbSchema, ...messagingSchema };
  const db = drizzle({ client: sqlite, schema }) as unknown as VobaseDb;

  return { sqlite, db };
}
