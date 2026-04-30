import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import type { ParameterSchemaT } from './lib/parameter-schema'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Conversations pgSchema — contacts, conversations, channels, messaging
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const messagingPgSchema = pgSchema('messaging')

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
    attributes: jsonb('attributes').default({}),
    marketingOptOut: boolean('marketing_opt_out').notNull().default(false),
    marketingOptOutAt: timestamp('marketing_opt_out_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
)

// ─── Contact Attribute Definitions ──────────────────────────────────

export const contactAttributeDefinitions = messagingPgSchema.table(
  'contact_attribute_definitions',
  {
    id: nanoidPrimaryKey(),
    key: text('key').notNull().unique(),
    label: text('label').notNull(),
    type: text('type').notNull().default('text'),
    showInTable: boolean('show_in_table').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('contact_attr_defs_key_idx').on(table.key),
    check('contact_attr_defs_type_check', sql`type IN ('text', 'number', 'boolean', 'date')`),
  ],
)

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('channel_instances_type_idx').on(table.type),
    index('channel_instances_status_idx').on(table.status),
    index('channel_instances_integration_idx').on(table.integrationId),
    check('channel_instances_source_check', sql`source IN ('env', 'self', 'platform', 'sandbox')`),
    check('channel_instances_status_check', sql`status IN ('active', 'disconnected', 'error')`),
  ],
)

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('channel_routings_channel_instance_idx').on(table.channelInstanceId),
    index('channel_routings_agent_id_idx').on(table.agentId),
    check('channel_routings_assignment_check', sql`assignment_pattern IN ('direct', 'router', 'workflow')`),
  ],
)

// ─── Conversations ────────────────────────────────────────────────
// One conversation per (contact, channelInstance). The primary entity of this module.

export const conversations = messagingPgSchema.table(
  'conversations',
  {
    id: nanoidPrimaryKey(),
    channelRoutingId: text('channel_routing_id').references(() => channelRoutings.id),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    agentId: text('agent_id').notNull(),
    channelInstanceId: text('channel_instance_id')
      .notNull()
      .references(() => channelInstances.id),
    title: text('title'),
    status: text('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
    index('conversations_active_stale_idx').on(table.status, table.updatedAt).where(sql`status = 'active'`),
    index('idx_conv_assignee_status').on(table.assignee, table.status),
    index('idx_conv_resolved').on(table.status, table.updatedAt),
    index('idx_conv_reopen').on(table.contactId, table.channelInstanceId, table.status, table.resolvedAt),
    check('conversations_status_check', sql`status IN ('active', 'resolving', 'resolved', 'failed')`),
    check('conversations_priority_check', sql`priority IS NULL OR priority IN ('low', 'normal', 'high', 'urgent')`),
    check(
      'conversations_outcome_check',
      sql`outcome IS NULL OR outcome IN ('resolved', 'escalated', 'abandoned', 'topic_change')`,
    ),
    check(
      'conversations_autonomy_level_check',
      sql`autonomy_level IS NULL OR autonomy_level IN ('full_ai', 'ai_with_escalation', 'human_assisted', 'human_only')`,
    ),
  ],
)

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
    caption: text('caption'),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_messages_conversation_created').on(table.conversationId, table.createdAt),
    uniqueIndex('idx_messages_external_id_unique')
      .on(table.externalMessageId)
      .where(sql`external_message_id IS NOT NULL`),
    index('idx_messages_pending_delivery').on(table.conversationId, table.status).where(sql`status = 'queued'`),
    index('idx_messages_type_created').on(table.messageType, table.createdAt),
    index('idx_messages_sender').on(table.senderId),
    index('idx_messages_pending_attention').on(table.resolutionStatus).where(sql`resolution_status = 'pending'`),
    index('idx_messages_mentions').using('gin', sql`mentions jsonb_path_ops`),
    check('messages_type_check', sql`message_type IN ('incoming', 'outgoing', 'activity')`),
    check(
      'messages_content_type_check',
      sql`content_type IN ('text', 'image', 'document', 'audio', 'video', 'template', 'interactive', 'sticker', 'email', 'reaction', 'button_reply', 'list_reply', 'unsupported', 'system')`,
    ),
    check('messages_sender_type_check', sql`sender_type IN ('contact', 'user', 'agent', 'system')`),
    check('messages_status_check', sql`status IS NULL OR status IN ('queued', 'sent', 'delivered', 'read', 'failed')`),
    check(
      'messages_resolution_status_check',
      sql`resolution_status IS NULL OR resolution_status IN ('pending', 'reviewed', 'dismissed')`,
    ),
  ],
)

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
    windowOpensAt: timestamp('window_opens_at', { withTimezone: true }).notNull().defaultNow(),
    windowExpiresAt: timestamp('window_expires_at', {
      withTimezone: true,
    }).notNull(),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('channel_sessions_conv_instance_unique').on(table.conversationId, table.channelInstanceId),
    index('channel_sessions_expiry_idx')
      .on(table.sessionState, table.windowExpiresAt)
      .where(sql`session_state = 'window_open'`),
    check('channel_sessions_state_check', sql`session_state IN ('window_open', 'window_expired')`),
  ],
)

// ─── Labels ────────────────────────────────────────────────────────

export const labels = messagingPgSchema.table('labels', {
  id: nanoidPrimaryKey(),
  title: text('title').notNull().unique(),
  color: text('color'),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('conversation_labels_unique_idx').on(table.conversationId, table.labelId)],
)

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('contact_labels_unique_idx').on(table.contactId, table.labelId)],
)

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('reactions_unique_idx').on(table.messageId, table.userId, table.contactId, table.emoji),
    check('reactions_actor_check', sql`user_id IS NOT NULL OR contact_id IS NOT NULL`),
  ],
)

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
    check('message_feedback_rating_check', sql`rating IN ('positive', 'negative')`),
    check('message_feedback_actor_check', sql`user_id IS NOT NULL OR contact_id IS NOT NULL`),
  ],
)

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
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('conversation_participants_unique_idx').on(table.conversationId, table.contactId),
    check('conversation_participants_role_check', sql`role IN ('initiator', 'participant', 'cc', 'bcc')`),
  ],
)

// ─── Channel Instance Teams ────────────────────────────────────────
// Maps channel instances to better-auth teams for visibility control.

export const channelInstanceTeams = messagingPgSchema.table(
  'channel_instance_teams',
  {
    channelInstanceId: text('channel_instance_id')
      .notNull()
      .references(() => channelInstances.id, { onDelete: 'cascade' }),
    teamId: text('team_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.channelInstanceId, table.teamId] })],
)

// ─── Broadcasts ───────────────────────────────────────────────────

export const broadcasts = messagingPgSchema.table(
  'broadcasts',
  {
    id: nanoidPrimaryKey(),
    name: text('name').notNull(),
    channelInstanceId: text('channel_instance_id')
      .notNull()
      .references(() => channelInstances.id),
    templateId: text('template_id').notNull(),
    templateName: text('template_name').notNull(),
    templateLanguage: text('template_language').notNull().default('en'),
    variableMapping: jsonb('variable_mapping').default({}),
    status: text('status').notNull().default('draft'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    timezone: text('timezone').default('UTC'),
    totalRecipients: integer('total_recipients').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    deliveredCount: integer('delivered_count').notNull().default(0),
    readCount: integer('read_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('broadcasts_status_idx').on(table.status),
    index('broadcasts_scheduled_idx').on(table.status, table.scheduledAt).where(sql`status = 'scheduled'`),
    index('broadcasts_created_by_idx').on(table.createdBy),
    check(
      'broadcasts_status_check',
      sql`status IN ('draft', 'scheduled', 'sending', 'paused', 'completed', 'failed', 'cancelled')`,
    ),
  ],
)

// ─── Broadcast Recipients ─────────────────────────────────────────

export const broadcastRecipients = messagingPgSchema.table(
  'broadcast_recipients',
  {
    id: nanoidPrimaryKey(),
    broadcastId: text('broadcast_id')
      .notNull()
      .references(() => broadcasts.id, { onDelete: 'cascade' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    phone: text('phone').notNull(),
    variables: jsonb('variables').default({}),
    status: text('status').notNull().default('queued'),
    externalMessageId: text('external_message_id'),
    failureReason: text('failure_reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('broadcast_recipients_broadcast_idx').on(table.broadcastId),
    index('broadcast_recipients_contact_idx').on(table.contactId),
    index('broadcast_recipients_status_idx').on(table.broadcastId, table.status),
    uniqueIndex('broadcast_recipients_unique').on(table.broadcastId, table.contactId),
    index('broadcast_recipients_external_msg_idx').on(table.externalMessageId),
    check(
      'broadcast_recipients_status_check',
      sql`status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped')`,
    ),
  ],
)

// ─── Automation Rules ─────────────────────────────────────────────
// Declarative rules that fire on recurring schedules or date-relative
// attributes (e.g. birthdays, subscription expiry). Each firing produces
// one automationExecutions row and one automationRecipients row per target
// contact; chaser follow-up steps are driven by `currentStep` + `nextStepAt`.

export const automationRules = messagingPgSchema.table(
  'automation_rules',
  {
    id: nanoidPrimaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    type: text('type').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    audienceFilter: jsonb('audience_filter').notNull().default({}),
    audienceResolverName: text('audience_resolver_name'),
    channelInstanceId: text('channel_instance_id')
      .notNull()
      .references(() => channelInstances.id, { onDelete: 'restrict' }),
    schedule: text('schedule'),
    dateAttribute: text('date_attribute'),
    timezone: text('timezone').notNull().default('UTC'),
    parameters: jsonb('parameters').notNull().default({}),
    parameterSchema: jsonb('parameter_schema').$type<ParameterSchemaT>().notNull().default({}),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
    nextFireAt: timestamp('next_fire_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('automation_rules_active_next_fire_idx').on(table.isActive, table.nextFireAt).where(sql`is_active = true`),
    index('automation_rules_type_idx').on(table.type),
    index('automation_rules_channel_instance_idx').on(table.channelInstanceId),
    check('automation_rules_type_check', sql`type IN ('recurring', 'date-relative')`),
  ],
)

// ─── Automation Rule Steps ────────────────────────────────────────
// Sequence 1 is the primary trigger (uses offsetDays/sendAtTime for
// date-relative rules). Sequences 2+ are chasers that fire delayHours
// after the prior step's send time.

export const automationRuleSteps = messagingPgSchema.table(
  'automation_rule_steps',
  {
    id: nanoidPrimaryKey(),
    ruleId: text('rule_id')
      .notNull()
      .references(() => automationRules.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    offsetDays: integer('offset_days'),
    sendAtTime: text('send_at_time'),
    delayHours: integer('delay_hours'),
    templateId: text('template_id').notNull(),
    templateName: text('template_name').notNull(),
    templateLanguage: text('template_language').notNull().default('en'),
    variableMapping: jsonb('variable_mapping').notNull().default({}),
    isFinal: boolean('is_final').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('automation_rule_steps_rule_sequence_unique').on(table.ruleId, table.sequence),
    index('automation_rule_steps_rule_idx').on(table.ruleId),
    check(
      'automation_rule_steps_send_at_time_format',
      sql`send_at_time IS NULL OR send_at_time ~ '^([0-1][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
  ],
)

// ─── Automation Executions ────────────────────────────────────────
// One row per firing of a rule step. A weekly rule running for a year
// produces ~52 executions per step. Counter columns are updated atomically
// by the send executor as each recipient progresses.

export const automationExecutions = messagingPgSchema.table(
  'automation_executions',
  {
    id: nanoidPrimaryKey(),
    ruleId: text('rule_id')
      .notNull()
      .references(() => automationRules.id, { onDelete: 'cascade' }),
    stepSequence: integer('step_sequence').notNull(),
    firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('running'),
    totalRecipients: integer('total_recipients').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    deliveredCount: integer('delivered_count').notNull().default(0),
    readCount: integer('read_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('automation_executions_rule_idx').on(table.ruleId),
    index('automation_executions_status_idx').on(table.status),
    index('automation_executions_fired_at_idx').on(table.firedAt),
    check('automation_executions_status_check', sql`status IN ('running', 'completed', 'failed')`),
  ],
)

// ─── Automation Recipients ────────────────────────────────────────
// One row per contact targeted by an execution. `currentStep` + `nextStepAt`
// drive the chaser advancement job (FOR UPDATE SKIP LOCKED on the
// (status, nextStepAt) index hot-path).
//
// `dateValue` computation rule: for date-relative rules,
//   dateValue = (contact.attributes->>rule.dateAttribute)::date AT TIME ZONE rule.timezone
// — computed in the evaluator, stored at insert time, never recomputed.
// For recurring rules `dateValue` is NULL.

export const automationRecipients = messagingPgSchema.table(
  'automation_recipients',
  {
    id: nanoidPrimaryKey(),
    executionId: text('execution_id')
      .notNull()
      .references(() => automationExecutions.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').notNull(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),
    phone: text('phone').notNull(),
    variables: jsonb('variables').notNull().default({}),
    currentStep: integer('current_step').notNull().default(1),
    nextStepAt: timestamp('next_step_at', { withTimezone: true }),
    status: text('status').notNull().default('queued'),
    externalMessageId: text('external_message_id'),
    failureReason: text('failure_reason'),
    dateValue: date('date_value'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('automation_recipients_status_next_step_idx').on(table.status, table.nextStepAt),
    // Chaser-claim hot path — partial index on (next_step_at) for rows eligible to advance.
    index('automation_recipients_chaser_claim_idx')
      .on(table.nextStepAt)
      .where(sql`status IN ('sent', 'delivered', 'read') AND replied_at IS NULL`),
    // Executor batch loader — partial index for rows still queued within an execution.
    index('automation_recipients_execution_queued_idx').on(table.executionId).where(sql`status = 'queued'`),
    index('automation_recipients_rule_idx').on(table.ruleId),
    index('automation_recipients_execution_idx').on(table.executionId),
    index('automation_recipients_contact_idx').on(table.contactId),
    index('automation_recipients_external_msg_idx').on(table.externalMessageId),
    uniqueIndex('automation_recipients_rule_contact_date_unique')
      .on(table.ruleId, table.contactId, table.dateValue)
      .where(sql`date_value IS NOT NULL`),
    check(
      'automation_recipients_status_check',
      sql`status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped', 'replied', 'chaser_paused')`,
    ),
  ],
)
