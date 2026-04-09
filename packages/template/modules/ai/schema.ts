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
// Interactions pgSchema — contacts, interactions, channels, messaging
// Two pgSchema namespaces coexist: 'interactions' (messaging) + 'ai' (memory, evals)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const interactionsPgSchema = pgSchema('interactions');

// ─── Contacts ────────────────────────────────────────────────────────

export const contacts = interactionsPgSchema.table(
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

export const channelInstances = interactionsPgSchema.table(
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

export const channelRoutings = interactionsPgSchema.table(
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

// ─── Interactions ──────────────────────────────────────────────────
// AI ↔ person interactions. The primary entity of this module.

export const interactions = interactionsPgSchema.table(
  'interactions',
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
    title: text('title'),
    interactionType: text('interaction_type').notNull().default('message'),
    status: text('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    outcome: text('outcome'),
    autonomyLevel: text('autonomy_level'),
    reopenCount: integer('reopen_count').notNull().default(0),
    topicChangePending: boolean('topic_change_pending')
      .notNull()
      .default(false),
    metadata: jsonb('metadata').default({}),
    mode: text('mode').notNull().default('ai'),
    assignee: text('assignee'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    priority: text('priority'),
    hasPendingEscalation: boolean('has_pending_escalation')
      .notNull()
      .default(false),
    waitingSince: timestamp('waiting_since', { withTimezone: true }),
    unreadCount: integer('unread_count').notNull().default(0),
    customAttributes: jsonb('custom_attributes').default({}),
    firstRepliedAt: timestamp('first_replied_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    contactLastSeenAt: timestamp('contact_last_seen_at', {
      withTimezone: true,
    }),
    agentLastSeenAt: timestamp('agent_last_seen_at', { withTimezone: true }),
    lastMessageContent: text('last_message_content'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    lastMessageType: text('last_message_type'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('interactions_contact_id_idx').on(table.contactId),
    index('interactions_agent_id_idx').on(table.agentId),
    index('interactions_status_idx').on(table.status),
    index('interactions_channel_routing_id_idx').on(table.channelRoutingId),
    index('interactions_channel_instance_idx').on(table.channelInstanceId),
    index('interactions_active_stale_idx')
      .on(table.status, table.updatedAt)
      .where(sql`status = 'active'`),
    index('interactions_assignee_status_idx').on(
      table.assignee,
      table.status,
      table.updatedAt,
    ),
    index('interactions_mode_queue_idx')
      .on(table.mode, table.status, table.priority)
      .where(sql`status = 'active'`),
    index('idx_int_attention').on(table.status, table.mode, table.updatedAt),
    index('idx_int_resolved').on(table.status, table.updatedAt),
    index('idx_int_last_activity').on(table.lastActivityAt),
    index('idx_int_reopen').on(
      table.contactId,
      table.channelInstanceId,
      table.status,
      table.resolvedAt,
    ),
    index('idx_int_contact_tab').on(
      table.contactId,
      table.status,
      table.mode,
      table.hasPendingEscalation,
    ),
    check(
      'interactions_status_check',
      sql`status IN ('active', 'resolving', 'resolved', 'failed')`,
    ),
    check('interactions_type_check', sql`interaction_type IN ('message')`),
    check(
      'interactions_mode_check',
      sql`mode IN ('ai', 'human', 'supervised', 'held')`,
    ),
    check(
      'interactions_priority_check',
      sql`priority IS NULL OR priority IN ('low', 'normal', 'high', 'urgent')`,
    ),
    check(
      'interactions_outcome_check',
      sql`outcome IS NULL OR outcome IN ('resolved', 'escalated', 'abandoned', 'topic_change')`,
    ),
    check(
      'interactions_autonomy_level_check',
      sql`autonomy_level IS NULL OR autonomy_level IN ('full_ai', 'ai_with_escalation', 'human_assisted', 'human_only')`,
    ),
  ],
);

// ─── Consultations ──────────────────────────────────────────────────
// Human fallback via channels (consult-human pattern).

export const consultations = interactionsPgSchema.table(
  'consultations',
  {
    id: nanoidPrimaryKey(),
    interactionId: text('interaction_id')
      .notNull()
      .references(() => interactions.id),
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
    replyPayload: jsonb('reply_payload'),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    timeoutMinutes: integer('timeout_minutes').notNull().default(30),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('consultations_interaction_id_idx').on(table.interactionId),
    index('consultations_status_idx').on(table.status),
    index('consultations_staff_idx').on(table.staffContactId),
    index('consultations_pending_timeout_idx')
      .on(table.status, table.requestedAt)
      .where(sql`status = 'pending'`),
    check(
      'consultations_status_check',
      sql`status IN ('pending', 'replied', 'timeout', 'notification_failed')`,
    ),
  ],
);

// ─── Messages ──────────────────────────────────────────────────────
// Single source of truth for all interaction content and activity.

export const messages = interactionsPgSchema.table(
  'messages',
  {
    id: nanoidPrimaryKey(),
    interactionId: text('interaction_id')
      .notNull()
      .references(() => interactions.id, { onDelete: 'cascade' }),
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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_messages_interaction_created').on(
      table.interactionId,
      table.createdAt,
    ),
    uniqueIndex('idx_messages_external_id_unique')
      .on(table.externalMessageId)
      .where(sql`external_message_id IS NOT NULL`),
    index('idx_messages_pending_delivery')
      .on(table.interactionId, table.status)
      .where(sql`status = 'queued'`),
    index('idx_messages_type_created').on(table.messageType, table.createdAt),
    index('idx_messages_sender').on(table.senderId),
    index('idx_messages_pending_attention')
      .on(table.resolutionStatus)
      .where(sql`resolution_status = 'pending'`),
    check(
      'messages_type_check',
      sql`message_type IN ('incoming', 'outgoing', 'activity')`,
    ),
    check(
      'messages_content_type_check',
      sql`content_type IN ('text', 'image', 'document', 'audio', 'video', 'template', 'interactive', 'sticker', 'email', 'system')`,
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
// Tracks messaging window state per interaction + channel instance (e.g. WhatsApp 24h window).

export const channelSessions = interactionsPgSchema.table(
  'channel_sessions',
  {
    id: nanoidPrimaryKey(),
    interactionId: text('interaction_id')
      .notNull()
      .references(() => interactions.id),
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
    uniqueIndex('channel_sessions_int_instance_unique').on(
      table.interactionId,
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

export const labels = interactionsPgSchema.table('labels', {
  id: nanoidPrimaryKey(),
  title: text('title').notNull().unique(),
  color: text('color'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Interaction Labels (join table) ──────────────────────────────

export const interactionLabels = interactionsPgSchema.table(
  'interaction_labels',
  {
    id: nanoidPrimaryKey(),
    interactionId: text('interaction_id')
      .notNull()
      .references(() => interactions.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('interaction_labels_unique_idx').on(
      table.interactionId,
      table.labelId,
    ),
  ],
);

// ─── Contact Labels (join table) ────────────────────────────────

export const contactLabels = interactionsPgSchema.table(
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

export const reactions = interactionsPgSchema.table(
  'reactions',
  {
    id: nanoidPrimaryKey(),
    messageId: text('message_id').notNull(),
    interactionId: text('interaction_id')
      .notNull()
      .references(() => interactions.id, { onDelete: 'cascade' }),
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

export const messageFeedback = interactionsPgSchema.table(
  'message_feedback',
  {
    id: nanoidPrimaryKey(),
    interactionId: text('interaction_id')
      .notNull()
      .references(() => interactions.id, { onDelete: 'cascade' }),
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
    index('message_feedback_interaction_idx').on(table.interactionId),
    index('message_feedback_message_idx').on(table.messageId),
    uniqueIndex('message_feedback_reaction_unique_idx')
      .on(table.interactionId, table.messageId, table.userId, table.contactId)
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

// ─── Interaction Participants ──────────────────────────────────────
// Multi-participant support for interactions.

export const interactionParticipants = interactionsPgSchema.table(
  'interaction_participants',
  {
    id: nanoidPrimaryKey(),
    interactionId: text('interaction_id')
      .notNull()
      .references(() => interactions.id, { onDelete: 'cascade' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    role: text('role').notNull().default('initiator'),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('interaction_participants_unique_idx').on(
      table.interactionId,
      table.contactId,
    ),
    check(
      'interaction_participants_role_check',
      sql`role IN ('initiator', 'participant', 'cc', 'bcc')`,
    ),
  ],
);

// ─── Channel Instance Teams ────────────────────────────────────────
// Maps channel instances to better-auth teams for visibility control.

export const channelInstanceTeams = interactionsPgSchema.table(
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI pgSchema — memory, evals, workflows, moderation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const aiPgSchema = pgSchema('ai');

/**
 * Scorers — user-defined evaluation criteria stored in DB.
 * Each row becomes an LLM judge scorer at eval time via createScorer().
 */
export const aiScorers = aiPgSchema.table(
  'scorers',
  {
    id: nanoidPrimaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    criteria: text('criteria').notNull(),
    model: text('model').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('scorers_enabled_idx').on(table.enabled)],
);

/**
 * EvalRuns — tracks async eval scoring jobs.
 * Each run scores a set of input/output/context items using LLM judges.
 */
export const aiEvalRuns = aiPgSchema.table(
  'eval_runs',
  {
    id: nanoidPrimaryKey(),
    agentId: text('agent_id').notNull(),
    status: text('status').notNull().default('pending'), // pending | running | complete | error
    results: text('results'), // JSON stringified EvalRunResult
    errorMessage: text('error_message'),
    itemCount: integer('item_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('eval_runs_agent_id_idx').on(table.agentId),
    index('eval_runs_status_idx').on(table.status),
    check(
      'eval_runs_status_check',
      sql`status IN ('pending', 'running', 'complete', 'error')`,
    ),
  ],
);

/**
 * WorkflowRuns — tracks Mastra workflow lifecycle externally.
 * Complements in-memory workflow state with durable persistence.
 * Used by escalation (HITL) and follow-up workflows.
 */
export const aiWorkflowRuns = aiPgSchema.table(
  'workflow_runs',
  {
    id: nanoidPrimaryKey(),
    workflowId: text('workflow_id').notNull(), // e.g. 'ai:escalation', 'ai:follow-up'
    userId: text('user_id').notNull(), // owner — scoped to authenticated user
    status: text('status').notNull().default('running'), // running | suspended | completed | failed
    inputData: text('input_data').notNull(), // JSON stringified workflow input
    suspendPayload: text('suspend_payload'), // JSON stringified suspend data (when status=suspended)
    outputData: text('output_data'), // JSON stringified workflow output
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('workflow_runs_user_wf_created_idx').on(
      table.userId,
      table.workflowId,
      table.createdAt,
    ),
    index('workflow_runs_suspended_idx')
      .on(table.status)
      .where(sql`status = 'suspended'`),
    check(
      'workflow_runs_status_check',
      sql`status IN ('running', 'suspended', 'completed', 'failed')`,
    ),
  ],
);

/**
 * ModerationLogs — records content blocked by the moderation guardrail.
 * Written by the onBlock callback in the moderation processor.
 */
export const aiModerationLogs = aiPgSchema.table(
  'moderation_logs',
  {
    id: nanoidPrimaryKey(),
    agentId: text('agent_id').notNull(),
    channel: text('channel').notNull(), // 'web', 'whatsapp', 'email', etc.
    userId: text('user_id'),
    contactId: text('contact_id'),
    threadId: text('thread_id'),
    reason: text('reason').notNull(), // 'blocklist' | 'max_length'
    blockedContent: text('blocked_content'), // truncated to 200 chars in app layer
    matchedTerm: text('matched_term'), // the specific blocklist term that matched
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('moderation_logs_created_idx').on(table.createdAt),
    index('moderation_logs_agent_created_idx').on(
      table.agentId,
      table.createdAt,
    ),
  ],
);
