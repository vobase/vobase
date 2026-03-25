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
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { contacts, conversationsPgSchema } from '../contacts/schema';

// ─── Channel Instances ──────────────────────────────────────────────
// Multi-instance per channel type. Each instance has its own credentials.

export const channelInstances = conversationsPgSchema.table(
  'channel_instances',
  {
    id: nanoidPrimaryKey(),
    type: text('type').notNull(),
    integrationId: text('integration_id'),
    label: text('label').notNull(),
    source: text('source').notNull(),
    config: jsonb('config').default({}),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('channel_instances_type_idx').on(table.type),
    index('channel_instances_status_idx').on(table.status),
    index('channel_instances_integration_idx').on(table.integrationId),
    check(
      'channel_instances_source_check',
      sql`source IN ('env', 'self', 'platform', 'sandbox')`,
    ),
    check(
      'channel_instances_status_check',
      sql`status IN ('active', 'disconnected', 'error')`,
    ),
  ],
);

// ─── Endpoints ──────────────────────────────────────────────────────
// Channel instance → agent mapping. Replaces "inboxes" concept.

export const endpoints = conversationsPgSchema.table(
  'endpoints',
  {
    id: nanoidPrimaryKey(),
    name: text('name').notNull(),
    channelInstanceId: text('channel_instance_id')
      .notNull()
      .references(() => channelInstances.id),
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
    index('endpoints_channel_instance_idx').on(table.channelInstanceId),
    index('endpoints_agent_id_idx').on(table.agentId),
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
    channelInstanceId: text('channel_instance_id')
      .notNull()
      .references(() => channelInstances.id),
    sessionType: text('session_type').notNull().default('message'),
    status: text('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    callStartedAt: timestamp('call_started_at', { withTimezone: true }),
    callEndedAt: timestamp('call_ended_at', { withTimezone: true }),
    callDuration: integer('call_duration'),
    recordingUrl: text('recording_url'),
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
    index('sessions_channel_instance_idx').on(table.channelInstanceId),
    index('sessions_active_stale_idx')
      .on(table.status, table.updatedAt)
      .where(sql`status = 'active'`),
    check(
      'sessions_status_check',
      sql`status IN ('active', 'completed', 'failed', 'paused')`,
    ),
    check(
      'sessions_session_type_check',
      sql`session_type IN ('message', 'voice')`,
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
    channelType: text('channel_type').notNull(),
    channelInstanceId: text('channel_instance_id').references(
      () => channelInstances.id,
    ),
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
    index('consultations_pending_timeout_idx')
      .on(table.status, table.requestedAt)
      .where(sql`status = 'pending'`),
    check(
      'consultations_status_check',
      sql`status IN ('pending', 'replied', 'timeout', 'cancelled', 'notification_failed')`,
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
    channelType: text('channel_type').notNull(),
    channelInstanceId: text('channel_instance_id').references(
      () => channelInstances.id,
    ),
    payload: jsonb('payload'),
    externalMessageId: text('external_message_id'),
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
    index('outbox_status_created_idx').on(table.status, table.createdAt),
    uniqueIndex('outbox_external_id_unique_idx')
      .on(table.externalMessageId)
      .where(sql`external_message_id IS NOT NULL`),
    check(
      'outbox_status_check',
      sql`status IN ('queued', 'sent', 'delivered', 'read', 'failed')`,
    ),
  ],
);

// ─── Dead Letters ──────────────────────────────────────────────────
// Terminal store for outbox messages that exceeded max retries.

export const deadLetters = conversationsPgSchema.table(
  'dead_letters',
  {
    id: nanoidPrimaryKey(),
    originalOutboxId: text('original_outbox_id').notNull(),
    sessionId: text('session_id').notNull(),
    channelType: text('channel_type').notNull(),
    channelInstanceId: text('channel_instance_id'),
    recipientAddress: text('recipient_address'),
    content: text('content').notNull(),
    payload: jsonb('payload'),
    error: text('error'),
    retryCount: integer('retry_count').notNull(),
    status: text('status').notNull().default('dead'),
    failedAt: timestamp('failed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('dead_letters_channel_failed_idx').on(
      table.channelType,
      table.failedAt,
    ),
    index('dead_letters_session_idx').on(table.sessionId),
    check('dead_letters_status_check', sql`status IN ('dead', 'retried')`),
  ],
);
