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
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Conversations pgSchema — contacts, conversations, channels, messaging
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const messagingPgSchema = pgSchema('messaging');

// ─── Contacts ────────────────────────────────────────────────────────

export const contacts = messagingPgSchema.table(
  'contacts',
  {
    id: nanoidPrimaryKey(),
    phone: text('phone').unique(),
    email: text('email').unique(),
    name: text('name'),
    identifier: text('identifier').unique(),
    role: text('role').notNull().default('customer'),
    metadata: jsonb('metadata').default({}),
    workingMemory: text('working_memory'),
    resourceMetadata: jsonb('resource_metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('contacts_phone_idx').on(table.phone),
    index('contacts_email_idx').on(table.email),
    index('contacts_role_idx').on(table.role),
    check('contacts_role_check', sql`role IN ('customer', 'lead', 'staff')`),
  ],
);

// ─── Channel Instances ──────────────────────────────────────────────
// Multi-instance per channel type. Each instance has its own credentials.

export const channelInstances = messagingPgSchema.table(
  'channel_instances',
  {
    id: nanoidPrimaryKey(),
    type: text('type').notNull(),
    integrationId: text('integration_id'),
    label: text('label').notNull(),
    source: text('source').notNull(),
    config: jsonb('config').default({}),
    status: text('status').notNull().default('active'),
    statusError: text('status_error'),
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

export const channelRoutings = messagingPgSchema.table(
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

// ─── Conversations ────────────────────────────────────────────────
// One conversation per (contact, channelInstance). The primary entity of this module.

export const conversations = messagingPgSchema.table(
  'conversations',
  {
    id: nanoidPrimaryKey(),
    channelRoutingId: text('channel_routing_id').references(
      () => channelRoutings.id,
    ),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    agentId: text('agent_id').notNull(),
    channelInstanceId: text('channel_instance_id')
      .notNull()
      .references(() => channelInstances.id),
    title: text('title'),
    status: text('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    outcome: text('outcome'),
    autonomyLevel: text('autonomy_level'),
    reopenCount: integer('reopen_count').notNull().default(0),
    metadata: jsonb('metadata').default({}),
    assignee: text('assignee').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    onHold: boolean('on_hold').notNull().default(false),
    heldAt: timestamp('held_at', { withTimezone: true }),
    holdReason: text('hold_reason'),
    priority: text('priority'),
    customAttributes: jsonb('custom_attributes').default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('conversations_contact_channel_unique')
      .on(table.contactId, table.channelInstanceId)
      .where(sql`status IN ('active', 'resolving')`),
    index('conversations_contact_id_idx').on(table.contactId),
    index('conversations_agent_id_idx').on(table.agentId),
    index('conversations_status_idx').on(table.status),
    index('conversations_channel_routing_id_idx').on(table.channelRoutingId),
    index('conversations_channel_instance_idx').on(table.channelInstanceId),
    index('conversations_active_stale_idx')
      .on(table.status, table.updatedAt)
      .where(sql`status = 'active'`),
    index('idx_conv_assignee_status').on(table.assignee, table.status),
    index('idx_conv_resolved').on(table.status, table.updatedAt),
    index('idx_conv_reopen').on(
      table.contactId,
      table.channelInstanceId,
      table.status,
      table.resolvedAt,
    ),
    check(
      'conversations_status_check',
      sql`status IN ('active', 'resolving', 'resolved', 'failed')`,
    ),
    check(
      'conversations_priority_check',
      sql`priority IS NULL OR priority IN ('low', 'normal', 'high', 'urgent')`,
    ),
    check(
      'conversations_outcome_check',
      sql`outcome IS NULL OR outcome IN ('resolved', 'escalated', 'abandoned', 'topic_change')`,
    ),
    check(
      'conversations_autonomy_level_check',
      sql`autonomy_level IS NULL OR autonomy_level IN ('full_ai', 'ai_with_escalation', 'human_assisted', 'human_only')`,
    ),
  ],
);

// ─── Messages ──────────────────────────────────────────────────────
// Single source of truth for all conversation content and activity.

export const messages = messagingPgSchema.table(
  'messages',
  {
    id: nanoidPrimaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    messageType: text('message_type').notNull(),
    contentType: text('content_type').notNull(),
    content: text('content').notNull(),
    contentData: jsonb('content_data').default({}),
    mastraContent: jsonb('mastra_content'),
    status: text('status'),
    failureReason: text('failure_reason'),
    senderId: text('sender_id').notNull(),
    senderType: text('sender_type').notNull(),
    retryCount: integer('retry_count').notNull().default(0),
    externalMessageId: text('external_message_id'),
    channelType: text('channel_type'),
    private: boolean('private').notNull().default(false),
    withdrawn: boolean('withdrawn').notNull().default(false),
    replyToMessageId: text('reply_to_message_id'),
    resolutionStatus: text('resolution_status'),
    mentions: jsonb('mentions').default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_messages_conversation_created').on(
      table.conversationId,
      table.createdAt,
    ),
    uniqueIndex('idx_messages_external_id_unique')
      .on(table.externalMessageId)
      .where(sql`external_message_id IS NOT NULL`),
    index('idx_messages_pending_delivery')
      .on(table.conversationId, table.status)
      .where(sql`status = 'queued'`),
    index('idx_messages_type_created').on(table.messageType, table.createdAt),
    index('idx_messages_sender').on(table.senderId),
    index('idx_messages_pending_attention')
      .on(table.resolutionStatus)
      .where(sql`resolution_status = 'pending'`),
    index('idx_messages_mentions').using('gin', sql`mentions jsonb_path_ops`),
    check(
      'messages_type_check',
      sql`message_type IN ('incoming', 'outgoing', 'activity')`,
    ),
    check(
      'messages_content_type_check',
      sql`content_type IN ('text', 'image', 'document', 'audio', 'video', 'template', 'interactive', 'sticker', 'email', 'reaction', 'button_reply', 'list_reply', 'unsupported', 'system')`,
    ),
    check(
      'messages_sender_type_check',
      sql`sender_type IN ('contact', 'user', 'agent', 'system')`,
    ),
    check(
      'messages_status_check',
      sql`status IS NULL OR status IN ('queued', 'sent', 'delivered', 'read', 'failed')`,
    ),
    check(
      'messages_resolution_status_check',
      sql`resolution_status IS NULL OR resolution_status IN ('pending', 'reviewed', 'dismissed')`,
    ),
  ],
);

// ─── Channel Sessions ──────────────────────────────────────────────
// Tracks messaging window state per conversation + channel instance (e.g. WhatsApp 24h window).

export const channelSessions = messagingPgSchema.table(
  'channel_sessions',
  {
    id: nanoidPrimaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id),
    channelInstanceId: text('channel_instance_id')
      .notNull()
      .references(() => channelInstances.id),
    channelType: text('channel_type').notNull(),
    sessionState: text('session_state').notNull().default('window_open'),
    windowOpensAt: timestamp('window_opens_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    windowExpiresAt: timestamp('window_expires_at', {
      withTimezone: true,
    }).notNull(),
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
    uniqueIndex('channel_sessions_conv_instance_unique').on(
      table.conversationId,
      table.channelInstanceId,
    ),
    index('channel_sessions_expiry_idx')
      .on(table.sessionState, table.windowExpiresAt)
      .where(sql`session_state = 'window_open'`),
    check(
      'channel_sessions_state_check',
      sql`session_state IN ('window_open', 'window_expired')`,
    ),
  ],
);

// ─── Labels ────────────────────────────────────────────────────────

export const labels = messagingPgSchema.table('labels', {
  id: nanoidPrimaryKey(),
  title: text('title').notNull().unique(),
  color: text('color'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Conversation Labels (join table) ────────────────────────────

export const conversationLabels = messagingPgSchema.table(
  'conversation_labels',
  {
    id: nanoidPrimaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('conversation_labels_unique_idx').on(
      table.conversationId,
      table.labelId,
    ),
  ],
);

// ─── Contact Labels (join table) ────────────────────────────────

export const contactLabels = messagingPgSchema.table(
  'contact_labels',
  {
    id: nanoidPrimaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('contact_labels_unique_idx').on(table.contactId, table.labelId),
  ],
);

// ─── Reactions ─────────────────────────────────────────────────────

export const reactions = messagingPgSchema.table(
  'reactions',
  {
    id: nanoidPrimaryKey(),
    messageId: text('message_id').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: text('user_id'),
    contactId: text('contact_id'),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('reactions_unique_idx').on(
      table.messageId,
      table.userId,
      table.contactId,
      table.emoji,
    ),
    check(
      'reactions_actor_check',
      sql`user_id IS NOT NULL OR contact_id IS NOT NULL`,
    ),
  ],
);

// Per-message feedback (like/dislike) from visitors and staff.

export const messageFeedback = messagingPgSchema.table(
  'message_feedback',
  {
    id: nanoidPrimaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    rating: text('rating').notNull(),
    reason: text('reason'),
    userId: text('user_id'),
    contactId: text('contact_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('message_feedback_conversation_idx').on(table.conversationId),
    index('message_feedback_message_idx').on(table.messageId),
    uniqueIndex('message_feedback_reaction_unique_idx')
      .on(table.conversationId, table.messageId, table.userId, table.contactId)
      .where(sql`reason IS NULL`),
    check(
      'message_feedback_rating_check',
      sql`rating IN ('positive', 'negative')`,
    ),
    check(
      'message_feedback_actor_check',
      sql`user_id IS NOT NULL OR contact_id IS NOT NULL`,
    ),
  ],
);

// ─── Conversation Participants ────────────────────────────────────
// Multi-participant support for conversations.

export const conversationParticipants = messagingPgSchema.table(
  'conversation_participants',
  {
    id: nanoidPrimaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    role: text('role').notNull().default('initiator'),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('conversation_participants_unique_idx').on(
      table.conversationId,
      table.contactId,
    ),
    check(
      'conversation_participants_role_check',
      sql`role IN ('initiator', 'participant', 'cc', 'bcc')`,
    ),
  ],
);

// ─── Channel Instance Teams ────────────────────────────────────────
// Maps channel instances to better-auth teams for visibility control.

export const channelInstanceTeams = messagingPgSchema.table(
  'channel_instance_teams',
  {
    channelInstanceId: text('channel_instance_id')
      .notNull()
      .references(() => channelInstances.id, { onDelete: 'cascade' }),
    teamId: text('team_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.channelInstanceId, table.teamId] })],
);
