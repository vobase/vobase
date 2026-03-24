import { nanoidPrimaryKey } from '@vobase/core/schema';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

export const messagingPgSchema = pgSchema('messaging');

// ─── Teams ───────────────────────────────────────────────────────────

export const msgTeams = messagingPgSchema.table('teams', {
  id: nanoidPrimaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const msgTeamMembers = messagingPgSchema.table(
  'team_members',
  {
    id: nanoidPrimaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => msgTeams.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('team_members_team_user_unique').on(table.teamId, table.userId),
    check('team_members_role_check', sql`role IN ('member', 'lead')`),
  ],
);

// ─── Inboxes ─────────────────────────────────────────────────────────

export const msgInboxes = messagingPgSchema.table(
  'inboxes',
  {
    id: nanoidPrimaryKey(),
    name: text('name').notNull(),
    channel: text('channel').notNull(),
    channelConfig: jsonb('channel_config').default({}),
    defaultAgentId: text('default_agent_id'),
    teamId: text('team_id').references(() => msgTeams.id),
    autoResolveIdleMinutes: integer('auto_resolve_idle_minutes').default(120),
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
    check(
      'inboxes_channel_check',
      sql`channel IN ('whatsapp', 'web', 'email')`,
    ),
  ],
);

// ─── Labels ──────────────────────────────────────────────────────────

export const msgLabels = messagingPgSchema.table('labels', {
  id: nanoidPrimaryKey(),
  name: text('name').notNull().unique(),
  color: text('color'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Conversations ───────────────────────────────────────────────────

export const msgConversations = messagingPgSchema.table(
  'conversations',
  {
    id: nanoidPrimaryKey(),
    title: text('title'),
    agentId: text('agent_id'),
    userId: text('user_id'),
    contactId: text('contact_id'),
    channel: text('channel').notNull().default('web'),
    status: text('status').notNull().default('open'),
    handler: text('handler').notNull().default('ai'),
    inboxId: text('inbox_id').references(() => msgInboxes.id),
    assigneeId: text('assignee_id'),
    teamId: text('team_id').references(() => msgTeams.id),
    priority: text('priority').default('low'),
    escalationReason: text('escalation_reason'),
    escalationSummary: text('escalation_summary'),
    escalationAt: timestamp('escalation_at', { withTimezone: true }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    aiPausedAt: timestamp('ai_paused_at', { withTimezone: true }),
    aiResumeAt: timestamp('ai_resume_at', { withTimezone: true }),
    windowExpiresAt: timestamp('window_expires_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('conversations_user_id_idx').on(table.userId),
    index('conversations_agent_id_idx').on(table.agentId),
    index('conversations_contact_id_idx').on(table.contactId),
    index('conversations_user_channel_idx').on(table.userId, table.channel),
    index('conversations_status_idx').on(table.status),
    index('conversations_inbox_id_idx').on(table.inboxId),
    index('conversations_assignee_id_idx').on(table.assigneeId),
    index('conversations_team_id_idx').on(table.teamId),
    index('conversations_handler_idx').on(table.handler),
    index('conversations_priority_idx').on(table.priority),
    check(
      'conversations_status_check',
      sql`status IN ('open', 'pending', 'resolved', 'snoozed', 'closed')`,
    ),
    check(
      'conversations_handler_check',
      sql`handler IN ('ai', 'human', 'unassigned')`,
    ),
    check(
      'conversations_priority_check',
      sql`priority IN ('low', 'medium', 'high', 'urgent')`,
    ),
  ],
);

// ─── Conversation Labels (join table) ────────────────────────────────

export const msgConversationLabels = messagingPgSchema.table(
  'conversation_labels',
  {
    conversationId: text('conversation_id')
      .notNull()
      .references(() => msgConversations.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => msgLabels.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.labelId] })],
);

/**
 * Outbound message delivery tracking.
 * Conversation content lives in Mastra Memory; this table tracks the delivery
 * lifecycle (queued → sent → delivered → read → failed) for outbound channel messages.
 */
export const msgOutbox = messagingPgSchema.table(
  'outbox',
  {
    id: nanoidPrimaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => msgConversations.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    channel: text('channel').notNull().default('web'),
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
    index('outbox_conversation_id_idx').on(table.conversationId),
    index('outbox_external_id_idx').on(table.externalMessageId),
    index('outbox_queued_idx').on(table.status).where(sql`status = 'queued'`),
    check(
      'outbox_status_check',
      sql`status IN ('queued', 'sent', 'delivered', 'read', 'failed')`,
    ),
  ],
);

// ─── Contacts ────────────────────────────────────────────────────────

export const msgContacts = messagingPgSchema.table('contacts', {
  id: nanoidPrimaryKey(),
  phone: text('phone').unique(),
  email: text('email').unique(),
  name: text('name'),
  identifier: text('identifier'),
  channel: text('channel'),
  metadata: text('metadata'), // JSON
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ─── Contact Inboxes ─────────────────────────────────────────────────

export const msgContactInboxes = messagingPgSchema.table(
  'contact_inboxes',
  {
    id: nanoidPrimaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => msgContacts.id, { onDelete: 'cascade' }),
    inboxId: text('inbox_id')
      .notNull()
      .references(() => msgInboxes.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('contact_inboxes_inbox_source_unique').on(
      table.inboxId,
      table.sourceId,
    ),
  ],
);
