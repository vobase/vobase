import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { vector } from '@electric-sql/pglite/vector';
import type { VobaseDb } from '@vobase/core';
import { drizzle } from 'drizzle-orm/pglite';

import * as aiSchema from '../modules/ai/schema';
import * as contactsSchema from '../modules/contacts/schema';
import * as conversationsSchema from '../modules/conversations/schema';
import * as kbSchema from '../modules/knowledge-base/schema';

const nanoidSql = readFileSync(
  join(import.meta.dir, '../db/extensions/03_nanoid.sql'),
  'utf-8',
);

/**
 * Create an in-memory PGlite test database with contacts/conversations (and optionally KB/AI) tables.
 * Returns the PGlite instance (for raw queries + cleanup) and the Drizzle wrapper.
 */
export async function createTestDb(options?: {
  withVec?: boolean;
  withMemory?: boolean;
  withWorkflows?: boolean;
}) {
  const pglite = new PGlite({ extensions: { pgcrypto, vector } });

  await pglite.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pglite.query('CREATE EXTENSION IF NOT EXISTS vector');
  // nanoidSql contains multiple statements — use the multi-statement path
  await (pglite as any).exec(nanoidSql);

  // Create schemas for all template modules
  await pglite.query('CREATE SCHEMA IF NOT EXISTS "conversations"');
  await pglite.query('CREATE SCHEMA IF NOT EXISTS "ai"');
  await pglite.query('CREATE SCHEMA IF NOT EXISTS "kb"');

  // Contacts + Conversations tables (conversations schema shared by both modules)
  await (pglite as any).exec(`
    CREATE TABLE "conversations"."contacts" (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      phone TEXT UNIQUE,
      email TEXT UNIQUE,
      name TEXT,
      identifier TEXT,
      role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'lead', 'staff')),
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "conversations"."endpoints" (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      name TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'web', 'email')),
      agent_id TEXT NOT NULL,
      assignment_pattern TEXT NOT NULL DEFAULT 'direct' CHECK (assignment_pattern IN ('direct', 'router', 'workflow')),
      config JSONB DEFAULT '{}',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "conversations"."sessions" (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      endpoint_id TEXT NOT NULL REFERENCES "conversations"."endpoints" (id),
      contact_id TEXT NOT NULL REFERENCES "conversations"."contacts" (id),
      agent_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'paused')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "conversations"."consultations" (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      session_id TEXT NOT NULL REFERENCES "conversations"."sessions" (id),
      staff_contact_id TEXT NOT NULL REFERENCES "conversations"."contacts" (id),
      channel TEXT NOT NULL,
      reason TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'replied', 'timeout', 'cancelled')),
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      replied_at TIMESTAMPTZ,
      timeout_minutes INTEGER NOT NULL DEFAULT 30,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "conversations"."outbox" (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      session_id TEXT NOT NULL REFERENCES "conversations"."sessions" (id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      channel TEXT NOT NULL,
      payload JSONB,
      external_message_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  if (options?.withVec) {
    // KB tables with 4-dim vectors matching test embedding mocks
    // Order: sources first (referenced by documents and sync_logs)
    await (pglite as any).exec(`
      CREATE TABLE "kb"."sources" (
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

      CREATE TABLE "kb"."documents" (
        id TEXT PRIMARY KEY DEFAULT nanoid(12),
        title TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'upload',
        source_id TEXT REFERENCES "kb"."sources" (id) ON DELETE SET NULL,
        source_url TEXT,
        mime_type TEXT NOT NULL DEFAULT 'text/plain',
        status TEXT NOT NULL DEFAULT 'pending',
        chunk_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "kb"."chunks" (
        id TEXT PRIMARY KEY DEFAULT nanoid(12),
        document_id TEXT NOT NULL REFERENCES "kb"."documents" (id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT,
        embedding vector(4),
        search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "kb"."sync_logs" (
        id TEXT PRIMARY KEY DEFAULT nanoid(12),
        source_id TEXT NOT NULL REFERENCES "kb"."sources" (id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        documents_processed INTEGER NOT NULL DEFAULT 0,
        errors TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
    `);
  }

  if (options?.withMemory) {
    await (pglite as any).exec(`
      CREATE TABLE "ai"."mem_cells" (
        id TEXT PRIMARY KEY DEFAULT nanoid(12),
        thread_id TEXT NOT NULL,
        contact_id TEXT,
        user_id TEXT,
        start_message_id TEXT NOT NULL,
        end_message_id TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        token_count INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "ai"."mem_episodes" (
        id TEXT PRIMARY KEY DEFAULT nanoid(12),
        cell_id TEXT NOT NULL REFERENCES "ai"."mem_cells" (id) ON DELETE CASCADE,
        contact_id TEXT,
        user_id TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding vector(4),
        search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || content)) STORED,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "ai"."mem_event_logs" (
        id TEXT PRIMARY KEY DEFAULT nanoid(12),
        cell_id TEXT NOT NULL REFERENCES "ai"."mem_cells" (id) ON DELETE CASCADE,
        contact_id TEXT,
        user_id TEXT,
        fact TEXT NOT NULL,
        subject TEXT,
        occurred_at TIMESTAMPTZ,
        embedding vector(4),
        search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', fact)) STORED,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  if (options?.withWorkflows) {
    await (pglite as any).exec(`
      CREATE TABLE "ai"."workflow_runs" (
        id TEXT PRIMARY KEY DEFAULT nanoid(12),
        workflow_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        input_data TEXT NOT NULL,
        suspend_payload TEXT,
        output_data TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "ai"."moderation_logs" (
        id TEXT PRIMARY KEY DEFAULT nanoid(12),
        agent_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        user_id TEXT,
        contact_id TEXT,
        thread_id TEXT,
        reason TEXT NOT NULL,
        blocked_content TEXT,
        matched_term TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  const schema = {
    ...aiSchema,
    ...kbSchema,
    ...contactsSchema,
    ...conversationsSchema,
  };
  const db = drizzle({ client: pglite, schema }) as unknown as VobaseDb;

  return { pglite, db };
}
