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

// ─── Channel Routings ───────────────────────────────────────────────
// Channel instance → agent mapping. Determines which agent handles messages.

export const channelRoutings = conversationsPgSchema.table(
  'channel_routings',
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
    index('channel_routings_channel_instance_idx').on(table.channelInstanceId),
    index('channel_routings_agent_id_idx').on(table.agentId),
    check(
      'channel_routings_assignment_check',
      sql`assignment_pattern IN ('direct', 'router', 'workflow')`,
    ),
  ],
);

// ─── Conversations ──────────────────────────────────────────────────
// AI ↔ person conversations. The primary entity of this module.

export const conversations = conversationsPgSchema.table(
  'conversations',
  {
    id: nanoidPrimaryKey(),
    channelRoutingId: text('channel_routing_id')
      .notNull()
      .references(() => channelRoutings.id),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    agentId: text('agent_id').notNull(),
    channelInstanceId: text('channel_instance_id')
      .notNull()
      .references(() => channelInstances.id),
    conversationType: text('conversation_type').notNull().default('message'),
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
    handler: text('handler').notNull().default('ai'),
    assignedUserId: text('assigned_user_id'),
    resolutionOutcome: text('resolution_outcome'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('conversations_contact_id_idx').on(table.contactId),
    index('conversations_agent_id_idx').on(table.agentId),
    index('conversations_status_idx').on(table.status),
    index('conversations_channel_routing_id_idx').on(table.channelRoutingId),
    index('conversations_channel_instance_idx').on(table.channelInstanceId),
    index('conversations_active_stale_idx')
      .on(table.status, table.updatedAt)
      .where(sql`status = 'active'`),
    check(
      'conversations_status_check',
      sql`status IN ('active', 'completed', 'failed', 'paused', 'escalated')`,
    ),
    check(
      'conversations_type_check',
      sql`conversation_type IN ('message', 'voice')`,
    ),
    check(
      'conversations_handler_check',
      sql`handler IN ('ai', 'human', 'supervised', 'paused')`,
    ),
    check(
      'conversations_resolution_outcome_check',
      sql`resolution_outcome IS NULL OR resolution_outcome IN ('resolved', 'escalated_resolved', 'abandoned', 'failed')`,
    ),
  ],
);

// ─── Consultations ──────────────────────────────────────────────────
// Human fallback via channels (consult-human pattern).

export const consultations = conversationsPgSchema.table(
  'consultations',
  {
    id: nanoidPrimaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id),
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
    index('consultations_conversation_id_idx').on(table.conversationId),
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

// ─── Activity Events ──────────────────────────────────────────────
// AVO (Actor-Verb-Object) pattern event stream for the control plane.

export const activityEvents = conversationsPgSchema.table(
  'activity_events',
  {
    id: nanoidPrimaryKey(),
    type: text('type').notNull(), // dot-notation: conversation.created, agent.tool_executed, etc.
    agentId: text('agent_id'),
    userId: text('user_id'), // staff user who triggered (null for system/agent)
    source: text('source').notNull(), // agent | staff | system
    contactId: text('contact_id'),
    conversationId: text('conversation_id'), // references conversations.id
    channelRoutingId: text('channel_routing_id'), // denormalized for dashboard queries
    channelType: text('channel_type'), // whatsapp | web | email
    data: jsonb('data').default({}), // event-specific payload
    resolutionStatus: text('resolution_status'), // pending | reviewed | dismissed (null for non-attention events)
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('activity_events_agent_created_idx').on(
      table.agentId,
      table.createdAt,
    ),
    index('activity_events_resolution_created_idx').on(
      table.resolutionStatus,
      table.createdAt,
    ),
    index('activity_events_conversation_idx').on(table.conversationId),
    index('activity_events_type_created_idx').on(table.type, table.createdAt),
    check(
      'activity_events_source_check',
      sql`source IN ('agent', 'staff', 'system')`,
    ),
    check(
      'activity_events_resolution_check',
      sql`resolution_status IS NULL OR resolution_status IN ('pending', 'reviewed', 'dismissed')`,
    ),
  ],
);

// ─── Outbox ─────────────────────────────────────────────────────────
// Outbound message delivery tracking.

export const outbox = conversationsPgSchema.table(
  'outbox',
  {
    id: nanoidPrimaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
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
    index('outbox_conversation_id_idx').on(table.conversationId),
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
    conversationId: text('conversation_id').notNull(),
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
    index('dead_letters_conversation_idx').on(table.conversationId),
    check('dead_letters_status_check', sql`status IN ('dead', 'retried')`),
  ],
);
