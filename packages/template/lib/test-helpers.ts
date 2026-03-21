import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { vector } from '@electric-sql/pglite/vector';
import type { VobaseDb } from '@vobase/core';
import { drizzle } from 'drizzle-orm/pglite';

import * as kbSchema from '../modules/knowledge-base/schema';
import * as messagingSchema from '../modules/messaging/schema';

const nanoidSql = readFileSync(
  join(import.meta.dir, '../db/extensions/nanoid.sql'),
  'utf-8',
);

/**
 * Create an in-memory PGlite test database with messaging (and optionally KB) tables.
 * Returns the PGlite instance (for raw queries + cleanup) and the Drizzle wrapper.
 */
export async function createTestDb(options?: { withVec?: boolean }) {
  const pglite = new PGlite({ extensions: { pgcrypto, vector } });

  await pglite.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pglite.exec('CREATE EXTENSION IF NOT EXISTS vector');
  await pglite.exec(nanoidSql);

  // Messaging tables (agents are code-defined, not in DB)
  await pglite.exec(`
    CREATE TABLE msg_threads (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      title TEXT,
      agent_id TEXT,
      user_id TEXT,
      contact_id TEXT,
      channel TEXT NOT NULL DEFAULT 'web',
      status TEXT NOT NULL DEFAULT 'ai',
      ai_paused_at TIMESTAMPTZ,
      ai_resume_at TIMESTAMPTZ,
      window_expires_at TIMESTAMPTZ,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE msg_messages (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE msg_contacts (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      phone TEXT UNIQUE,
      email TEXT UNIQUE,
      name TEXT,
      channel TEXT,
      metadata TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  if (options?.withVec) {
    // KB tables with 4-dim vectors matching test embedding mocks
    await pglite.exec(`
      CREATE TABLE kb_documents (
        id TEXT PRIMARY KEY DEFAULT nanoid(12),
        title TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'upload',
        source_id TEXT,
        source_url TEXT,
        mime_type TEXT NOT NULL DEFAULT 'text/plain',
        status TEXT NOT NULL DEFAULT 'pending',
        chunk_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE kb_chunks (
        id TEXT PRIMARY KEY DEFAULT nanoid(12),
        document_id TEXT NOT NULL,
        content TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT,
        embedding vector(4),
        search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE kb_sources (
        id TEXT PRIMARY KEY DEFAULT nanoid(12),
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT,
        sync_schedule TEXT,
        last_sync_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'idle',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE kb_sync_logs (
        id TEXT PRIMARY KEY DEFAULT nanoid(12),
        source_id TEXT NOT NULL,
        status TEXT NOT NULL,
        documents_processed INTEGER NOT NULL DEFAULT 0,
        errors TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
    `);
  }

  const schema = { ...kbSchema, ...messagingSchema };
  const db = drizzle({ client: pglite, schema }) as unknown as VobaseDb;

  return { pglite, db };
}
