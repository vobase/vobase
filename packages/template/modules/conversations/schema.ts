import { nanoidPrimaryKey } from '@vobase/core/schema';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { contacts, conversationsPgSchema } from '../contacts/schema';

// ─── Endpoints ──────────────────────────────────────────────────────
// Channel → agent mapping. Replaces "inboxes" concept.

export const endpoints = conversationsPgSchema.table(
  'endpoints',
  {
    id: nanoidPrimaryKey(),
    name: text('name').notNull(),
    channel: text('channel').notNull(),
    agentId: text('agent_id').notNull(),
    assignmentPattern: text('assignment_pattern').notNull().default('direct'),
    config: jsonb('config').default({}),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('endpoints_channel_idx').on(table.channel),
    index('endpoints_agent_id_idx').on(table.agentId),
    check(
      'endpoints_channel_check',
      sql`channel IN ('whatsapp', 'web', 'email')`,
    ),
    check(
      'endpoints_assignment_check',
      sql`assignment_pattern IN ('direct', 'router', 'workflow')`,
    ),
  ],
);

// ─── Sessions ───────────────────────────────────────────────────────
// AI ↔ person conversation sessions. Replaces "conversations" (ticketing).

export const sessions = conversationsPgSchema.table(
  'sessions',
  {
    id: nanoidPrimaryKey(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => endpoints.id),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    agentId: text('agent_id').notNull(),
    channel: text('channel').notNull(),
    status: text('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('sessions_contact_id_idx').on(table.contactId),
    index('sessions_agent_id_idx').on(table.agentId),
    index('sessions_status_idx').on(table.status),
    index('sessions_endpoint_id_idx').on(table.endpointId),
    index('sessions_channel_idx').on(table.channel),
    check(
      'sessions_status_check',
      sql`status IN ('active', 'completed', 'failed', 'paused')`,
    ),
  ],
);

// ─── Consultations ──────────────────────────────────────────────────
// Human fallback via channels (consult-human pattern).

export const consultations = conversationsPgSchema.table(
  'consultations',
  {
    id: nanoidPrimaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    staffContactId: text('staff_contact_id')
      .notNull()
      .references(() => contacts.id),
    channel: text('channel').notNull(),
    reason: text('reason').notNull(),
    summary: text('summary'),
    status: text('status').notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    timeoutMinutes: integer('timeout_minutes').notNull().default(30),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('consultations_session_id_idx').on(table.sessionId),
    index('consultations_status_idx').on(table.status),
    index('consultations_staff_idx').on(table.staffContactId),
    check(
      'consultations_status_check',
      sql`status IN ('pending', 'replied', 'timeout', 'cancelled')`,
    ),
  ],
);

// ─── Outbox ─────────────────────────────────────────────────────────
// Outbound message delivery tracking.

export const outbox = conversationsPgSchema.table(
  'outbox',
  {
    id: nanoidPrimaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    channel: text('channel').notNull(),
    payload: jsonb('payload'),
    externalMessageId: text('external_message_id').unique(),
    status: text('status').notNull().default('queued'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('outbox_session_id_idx').on(table.sessionId),
    index('outbox_external_id_idx').on(table.externalMessageId),
    index('outbox_queued_idx').on(table.status).where(sql`status = 'queued'`),
    check(
      'outbox_status_check',
      sql`status IN ('queued', 'sent', 'delivered', 'read', 'failed')`,
    ),
  ],
);
