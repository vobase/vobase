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

import * as kbSchema from '../modules/knowledge-base/schema';
import * as aiSchema from '../modules/messaging/schema';

const nanoidSql = readFileSync(
  join(import.meta.dir, '../db/extensions/03_nanoid.sql'),
  'utf-8',
);

const TEMPLATE_SCHEMAS = ['messaging', 'agents', 'kb', 'infra'] as const;

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
  withAutomation?: boolean;
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
    CREATE TABLE "messaging"."contacts" (
      id TEXT PRIMARY KEY DEFAULT nanoid(8),
      phone TEXT UNIQUE,
      email TEXT UNIQUE,
      name TEXT,
      identifier TEXT,
      role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'lead', 'staff')),
      attributes JSONB DEFAULT '{}',
      marketing_opt_out BOOLEAN NOT NULL DEFAULT FALSE,
      marketing_opt_out_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "messaging"."channel_instances" (
      id TEXT PRIMARY KEY DEFAULT nanoid(8),
      type TEXT NOT NULL,
      integration_id TEXT,
      label TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('env', 'self', 'platform', 'sandbox')),
      config JSONB DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected', 'error')),
      status_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "messaging"."channel_routings" (
      id TEXT PRIMARY KEY DEFAULT nanoid(8),
      name TEXT NOT NULL,
      channel_instance_id TEXT NOT NULL REFERENCES "messaging"."channel_instances" (id),
      agent_id TEXT NOT NULL,
      assignment_pattern TEXT NOT NULL DEFAULT 'direct' CHECK (assignment_pattern IN ('direct', 'router', 'workflow')),
      config JSONB DEFAULT '{}',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "messaging"."conversations" (
      id TEXT PRIMARY KEY DEFAULT nanoid(8),
      channel_routing_id TEXT REFERENCES "messaging"."channel_routings" (id),
      contact_id TEXT NOT NULL REFERENCES "messaging"."contacts" (id),
      agent_id TEXT NOT NULL,
      channel_instance_id TEXT NOT NULL REFERENCES "messaging"."channel_instances" (id),
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolving', 'resolved', 'failed')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      outcome TEXT CHECK (outcome IS NULL OR outcome IN ('resolved', 'escalated', 'abandoned', 'topic_change')),
      autonomy_level TEXT CHECK (autonomy_level IS NULL OR autonomy_level IN ('full_ai', 'ai_with_escalation', 'human_assisted', 'human_only')),
      reopen_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB DEFAULT '{}',
      assignee TEXT NOT NULL,
      assigned_at TIMESTAMPTZ,
      on_hold BOOLEAN NOT NULL DEFAULT FALSE,
      held_at TIMESTAMPTZ,
      hold_reason TEXT,
      priority TEXT CHECK (priority IS NULL OR priority IN ('low', 'normal', 'high', 'urgent')),
      custom_attributes JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX conversations_contact_channel_unique ON "messaging"."conversations" (contact_id, channel_instance_id) WHERE status IN ('active', 'resolving');

    CREATE TABLE "messaging"."messages" (
      id TEXT PRIMARY KEY DEFAULT nanoid(8),
      conversation_id TEXT NOT NULL REFERENCES "messaging"."conversations" (id) ON DELETE CASCADE,
      message_type TEXT NOT NULL CHECK (message_type IN ('incoming', 'outgoing', 'activity')),
      content_type TEXT NOT NULL CHECK (content_type IN ('text', 'image', 'document', 'audio', 'video', 'template', 'interactive', 'sticker', 'email', 'system')),
      content TEXT NOT NULL,
      content_data JSONB DEFAULT '{}',
      caption TEXT,
      mastra_content JSONB,
      status TEXT CHECK (status IS NULL OR status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
      failure_reason TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      sender_id TEXT NOT NULL,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('contact', 'user', 'agent', 'system')),
      external_message_id TEXT,
      channel_type TEXT,
      private BOOLEAN NOT NULL DEFAULT FALSE,
      withdrawn BOOLEAN NOT NULL DEFAULT FALSE,
      reply_to_message_id TEXT,
      resolution_status TEXT CHECK (resolution_status IS NULL OR resolution_status IN ('pending', 'reviewed', 'dismissed')),
      mentions JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX idx_messages_external_id_unique ON "messaging"."messages" (external_message_id) WHERE external_message_id IS NOT NULL;

    CREATE TABLE "messaging"."channel_sessions" (
      id TEXT PRIMARY KEY DEFAULT nanoid(8),
      conversation_id TEXT NOT NULL REFERENCES "messaging"."conversations" (id),
      channel_instance_id TEXT NOT NULL REFERENCES "messaging"."channel_instances" (id),
      channel_type TEXT NOT NULL,
      session_state TEXT NOT NULL DEFAULT 'window_open' CHECK (session_state IN ('window_open', 'window_expired')),
      window_opens_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      window_expires_at TIMESTAMPTZ NOT NULL,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (conversation_id, channel_instance_id)
    );

    CREATE TABLE "messaging"."labels" (
      id TEXT PRIMARY KEY DEFAULT nanoid(8),
      title TEXT NOT NULL UNIQUE,
      color TEXT,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "messaging"."conversation_labels" (
      id TEXT PRIMARY KEY DEFAULT nanoid(8),
      conversation_id TEXT NOT NULL REFERENCES "messaging"."conversations" (id) ON DELETE CASCADE,
      label_id TEXT NOT NULL REFERENCES "messaging"."labels" (id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (conversation_id, label_id)
    );

    CREATE TABLE "messaging"."contact_labels" (
      id TEXT PRIMARY KEY DEFAULT nanoid(8),
      contact_id TEXT NOT NULL REFERENCES "messaging"."contacts" (id) ON DELETE CASCADE,
      label_id TEXT NOT NULL REFERENCES "messaging"."labels" (id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (contact_id, label_id)
    );

    CREATE TABLE "messaging"."broadcasts" (
      id TEXT PRIMARY KEY DEFAULT nanoid(8),
      name TEXT NOT NULL,
      channel_instance_id TEXT NOT NULL REFERENCES "messaging"."channel_instances" (id),
      template_id TEXT NOT NULL,
      template_name TEXT NOT NULL,
      template_language TEXT NOT NULL DEFAULT 'en',
      variable_mapping JSONB DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'paused', 'completed', 'failed', 'cancelled')),
      scheduled_at TIMESTAMPTZ,
      timezone TEXT DEFAULT 'UTC',
      total_recipients INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      delivered_count INTEGER NOT NULL DEFAULT 0,
      read_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "messaging"."broadcast_recipients" (
      id TEXT PRIMARY KEY DEFAULT nanoid(8),
      broadcast_id TEXT NOT NULL REFERENCES "messaging"."broadcasts" (id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES "messaging"."contacts" (id),
      phone TEXT NOT NULL,
      variables JSONB DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped')),
      external_message_id TEXT,
      failure_reason TEXT,
      sent_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (broadcast_id, contact_id)
    );

    CREATE TABLE "messaging"."contact_attribute_definitions" (
      id TEXT PRIMARY KEY DEFAULT nanoid(8),
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'number', 'boolean', 'date')),
      show_in_table BOOLEAN NOT NULL DEFAULT false,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE "messaging"."reactions" (
      id TEXT PRIMARY KEY DEFAULT nanoid(8),
      message_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES "messaging"."conversations" (id) ON DELETE CASCADE,
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
        id TEXT PRIMARY KEY DEFAULT nanoid(8),
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
        id TEXT PRIMARY KEY DEFAULT nanoid(8),
        title TEXT NOT NULL,
        folder TEXT,
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
        id TEXT PRIMARY KEY DEFAULT nanoid(8),
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
        id TEXT PRIMARY KEY DEFAULT nanoid(8),
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
      CREATE TABLE "agents"."mem_cells" (
        id TEXT PRIMARY KEY DEFAULT nanoid(8),
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

      CREATE TABLE "agents"."mem_episodes" (
        id TEXT PRIMARY KEY DEFAULT nanoid(8),
        cell_id TEXT NOT NULL REFERENCES "agents"."mem_cells" (id) ON DELETE CASCADE,
        contact_id TEXT,
        user_id TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding vector(4),
        search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || content)) STORED,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "agents"."mem_event_logs" (
        id TEXT PRIMARY KEY DEFAULT nanoid(8),
        cell_id TEXT NOT NULL REFERENCES "agents"."mem_cells" (id) ON DELETE CASCADE,
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
      CREATE TABLE "agents"."moderation_logs" (
        id TEXT PRIMARY KEY DEFAULT nanoid(8),
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

  if (options?.withAutomation) {
    // biome-ignore lint/suspicious/noExplicitAny: required by PGlite exec interface
    await (pglite as any).exec(`
      CREATE TABLE "infra"."channels_templates" (
        id TEXT PRIMARY KEY DEFAULT nanoid(8),
        channel TEXT NOT NULL,
        external_id TEXT UNIQUE,
        name TEXT NOT NULL,
        language TEXT NOT NULL,
        category TEXT,
        status TEXT,
        components TEXT,
        synced_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX "channels_templates_channel_idx" ON "infra"."channels_templates" (channel);
      CREATE INDEX "channels_templates_name_idx" ON "infra"."channels_templates" (name);

      CREATE TABLE "messaging"."automation_rules" (
        id TEXT PRIMARY KEY DEFAULT nanoid(8),
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL CHECK (type IN ('recurring', 'date-relative')),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        audience_filter JSONB NOT NULL DEFAULT '{}',
        audience_resolver_name TEXT,
        channel_instance_id TEXT NOT NULL REFERENCES "messaging"."channel_instances" (id) ON DELETE RESTRICT,
        schedule TEXT,
        date_attribute TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        parameters JSONB NOT NULL DEFAULT '{}',
        parameter_schema JSONB NOT NULL DEFAULT '{}',
        last_fired_at TIMESTAMPTZ,
        next_fire_at TIMESTAMPTZ,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE "messaging"."automation_rule_steps" (
        id TEXT PRIMARY KEY DEFAULT nanoid(8),
        rule_id TEXT NOT NULL REFERENCES "messaging"."automation_rules" (id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        offset_days INTEGER,
        send_at_time TEXT,
        delay_hours INTEGER,
        template_id TEXT NOT NULL,
        template_name TEXT NOT NULL,
        template_language TEXT NOT NULL DEFAULT 'en',
        variable_mapping JSONB NOT NULL DEFAULT '{}',
        is_final BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (rule_id, sequence)
      );
      CREATE TABLE "messaging"."automation_executions" (
        id TEXT PRIMARY KEY DEFAULT nanoid(8),
        rule_id TEXT NOT NULL REFERENCES "messaging"."automation_rules" (id) ON DELETE CASCADE,
        step_sequence INTEGER NOT NULL,
        fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
        total_recipients INTEGER NOT NULL DEFAULT 0,
        sent_count INTEGER NOT NULL DEFAULT 0,
        delivered_count INTEGER NOT NULL DEFAULT 0,
        read_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        completed_at TIMESTAMPTZ
      );
      CREATE TABLE "messaging"."automation_recipients" (
        id TEXT PRIMARY KEY DEFAULT nanoid(8),
        execution_id TEXT NOT NULL REFERENCES "messaging"."automation_executions" (id) ON DELETE CASCADE,
        rule_id TEXT NOT NULL,
        contact_id TEXT NOT NULL REFERENCES "messaging"."contacts" (id) ON DELETE RESTRICT,
        phone TEXT NOT NULL,
        variables JSONB NOT NULL DEFAULT '{}',
        current_step INTEGER NOT NULL DEFAULT 1,
        next_step_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped', 'replied', 'chaser_paused')),
        external_message_id TEXT,
        failure_reason TEXT,
        date_value DATE,
        sent_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        read_at TIMESTAMPTZ,
        replied_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX "automation_recipients_status_next_step_idx" ON "messaging"."automation_recipients" (status, next_step_at);
      CREATE UNIQUE INDEX "automation_recipients_rule_contact_date_unique" ON "messaging"."automation_recipients" (rule_id, contact_id, date_value) WHERE date_value IS NOT NULL;
    `);
  }

  const schema = {
    ...aiSchema,
    ...kbSchema,
  };
  const db = drizzle({ client: pglite, schema }) as unknown as VobaseDb;

  return { pglite, db };
}
