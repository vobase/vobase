/**
 * PGlite test helpers — global singleton with schema-based isolation.
 *
 * PGlite only supports one WASM instance per JS thread
 * (electric-sql/pglite#324). This module provides a process-wide singleton,
 * ensuring all test files share the same PGlite and avoiding WASM conflicts.
 *
 * Each call to createTestDb() resets the template schemas (DROP CASCADE +
 * CREATE), giving a clean slate. NEVER call pglite.close() in tests —
 * process exit handles cleanup.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { vector } from '@electric-sql/pglite/vector';
import type { VobaseDb } from '@vobase/core';
import { drizzle } from 'drizzle-orm/pglite';

import * as aiSchema from '../modules/ai/schema';
import * as kbSchema from '../modules/knowledge-base/schema';

const nanoidSql = readFileSync(
  join(import.meta.dir, '../db/extensions/03_nanoid.sql'),
  'utf-8',
);

const TEMPLATE_SCHEMAS = ['conversations', 'ai', 'kb'] as const;

let shared: PGlite | null = null;
let nanoidInstalled = false;

/**
 * Returns a process-wide singleton PGlite instance with pgcrypto + vector.
 * First call creates the instance; subsequent calls return the same one.
 */
async function getSharedPGlite(): Promise<PGlite> {
  if (!shared) {
    shared = new PGlite({ extensions: { pgcrypto, vector } });
    await shared.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await shared.query('CREATE EXTENSION IF NOT EXISTS vector');
  }
  return shared;
}

/**
 * Create an in-memory PGlite test database with freshly reset schemas.
 * Uses a process-wide singleton — safe to call in beforeEach().
 * NEVER call pglite.close() — process exit handles cleanup.
 */
export async function createTestDb(options?: {
  withVec?: boolean;
  withMemory?: boolean;
  withWorkflows?: boolean;
}) {
  const pglite = await getSharedPGlite();

  // Reset schemas for clean slate
  for (const s of TEMPLATE_SCHEMAS) {
    await pglite.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
    await pglite.query(`CREATE SCHEMA "${s}"`);
  }

  // Install nanoid function once (survives schema drops since it's in public)
  if (!nanoidInstalled) {
    // biome-ignore lint/suspicious/noExplicitAny: required by PGlite exec interface
    await (pglite as any).exec(nanoidSql);
    nanoidInstalled = true;
  }

  // Conversations tables (always created — most tests need them)
  // biome-ignore lint/suspicious/noExplicitAny: required by PGlite exec interface
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

    CREATE TABLE "conversations"."channel_instances" (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      type TEXT NOT NULL,
      integration_id TEXT,
      label TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('env', 'self', 'platform', 'sandbox')),
      config JSONB DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected', 'error')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "conversations"."channel_routings" (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      name TEXT NOT NULL,
      channel_instance_id TEXT NOT NULL REFERENCES "conversations"."channel_instances" (id),
      agent_id TEXT NOT NULL,
      assignment_pattern TEXT NOT NULL DEFAULT 'direct' CHECK (assignment_pattern IN ('direct', 'router', 'workflow')),
      config JSONB DEFAULT '{}',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "conversations"."conversations" (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      channel_routing_id TEXT NOT NULL REFERENCES "conversations"."channel_routings" (id),
      contact_id TEXT NOT NULL REFERENCES "conversations"."contacts" (id),
      agent_id TEXT NOT NULL,
      channel_instance_id TEXT NOT NULL REFERENCES "conversations"."channel_instances" (id),
      conversation_type TEXT NOT NULL DEFAULT 'message' CHECK (conversation_type IN ('message', 'voice')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      call_started_at TIMESTAMPTZ,
      call_ended_at TIMESTAMPTZ,
      call_duration INTEGER,
      recording_url TEXT,
      metadata JSONB DEFAULT '{}',
      mode TEXT NOT NULL DEFAULT 'ai' CHECK (mode IN ('ai', 'human', 'supervised', 'held')),
      assignee TEXT,
      assigned_at TIMESTAMPTZ,
      priority TEXT CHECK (priority IS NULL OR priority IN ('low', 'normal', 'high', 'urgent')),
      resolution_outcome TEXT CHECK (resolution_outcome IS NULL OR resolution_outcome IN ('resolved', 'escalated_resolved', 'abandoned', 'failed')),
      has_pending_escalation BOOLEAN NOT NULL DEFAULT FALSE,
      waiting_since TIMESTAMPTZ,
      unread_count INTEGER NOT NULL DEFAULT 0,
      custom_attributes JSONB DEFAULT '{}',
      first_response_due TIMESTAMPTZ,
      resolution_due TIMESTAMPTZ,
      first_replied_at TIMESTAMPTZ,
      sla_breached_at TIMESTAMPTZ,
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      contact_last_seen_at TIMESTAMPTZ,
      agent_last_seen_at TIMESTAMPTZ,
      last_message_content TEXT,
      last_message_at TIMESTAMPTZ,
      last_message_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "conversations"."consultations" (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      conversation_id TEXT NOT NULL REFERENCES "conversations"."conversations" (id),
      staff_contact_id TEXT NOT NULL REFERENCES "conversations"."contacts" (id),
      channel_type TEXT NOT NULL,
      channel_instance_id TEXT REFERENCES "conversations"."channel_instances" (id),
      reason TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'replied', 'timeout', 'cancelled', 'notification_failed')),
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      replied_at TIMESTAMPTZ,
      timeout_minutes INTEGER NOT NULL DEFAULT 30,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "conversations"."messages" (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      conversation_id TEXT NOT NULL REFERENCES "conversations"."conversations" (id) ON DELETE CASCADE,
      message_type TEXT NOT NULL CHECK (message_type IN ('incoming', 'outgoing', 'activity')),
      content_type TEXT NOT NULL CHECK (content_type IN ('text', 'image', 'document', 'audio', 'video', 'template', 'interactive', 'sticker', 'email', 'system')),
      content TEXT NOT NULL,
      content_data JSONB DEFAULT '{}',
      status TEXT CHECK (status IS NULL OR status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
      failure_reason TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      sender_id TEXT NOT NULL,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('contact', 'user', 'agent', 'system')),
      external_message_id TEXT,
      channel_type TEXT,
      private BOOLEAN NOT NULL DEFAULT FALSE,
      withdrawn BOOLEAN NOT NULL DEFAULT FALSE,
      resolution_status TEXT CHECK (resolution_status IS NULL OR resolution_status IN ('pending', 'reviewed', 'dismissed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX idx_messages_external_id_unique ON "conversations"."messages" (external_message_id) WHERE external_message_id IS NOT NULL;

    CREATE TABLE "conversations"."labels" (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      title TEXT NOT NULL UNIQUE,
      color TEXT,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "conversations"."conversation_labels" (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      conversation_id TEXT NOT NULL REFERENCES "conversations"."conversations" (id) ON DELETE CASCADE,
      label_id TEXT NOT NULL REFERENCES "conversations"."labels" (id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (conversation_id, label_id)
    );

    CREATE TABLE "conversations"."reactions" (
      id TEXT PRIMARY KEY DEFAULT nanoid(12),
      message_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES "conversations"."conversations" (id) ON DELETE CASCADE,
      user_id TEXT,
      contact_id TEXT,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (user_id IS NOT NULL OR contact_id IS NOT NULL),
      UNIQUE (message_id, user_id, contact_id, emoji)
    );
  `);

  if (options?.withVec) {
    // biome-ignore lint/suspicious/noExplicitAny: required by PGlite exec interface
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
        content JSONB,
        raw_content JSONB,
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
    // biome-ignore lint/suspicious/noExplicitAny: required by PGlite exec interface
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
    // biome-ignore lint/suspicious/noExplicitAny: required by PGlite exec interface
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
  };
  const db = drizzle({ client: pglite, schema }) as unknown as VobaseDb;

  return { pglite, db };
}
