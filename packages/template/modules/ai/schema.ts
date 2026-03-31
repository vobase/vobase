import { nanoidPrimaryKey } from '@vobase/core/schema';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// Hardcoded to match KB schema — change requires a migration anyway
const embeddingDimensions = 1536;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Conversations pgSchema — contacts, conversations, channels, messaging
// Two pgSchema namespaces coexist: 'conversations' (messaging) + 'ai' (memory, evals)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const conversationsPgSchema = pgSchema('conversations');

// ─── Contacts ────────────────────────────────────────────────────────

export const contacts = conversationsPgSchema.table(
  'contacts',
  {
    id: nanoidPrimaryKey(),
    phone: text('phone').unique(),
    email: text('email').unique(),
    name: text('name'),
    identifier: text('identifier'),
    role: text('role').notNull().default('customer'),
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
    index('contacts_phone_idx').on(table.phone),
    index('contacts_email_idx').on(table.email),
    index('contacts_role_idx').on(table.role),
    check('contacts_role_check', sql`role IN ('customer', 'lead', 'staff')`),
  ],
);

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
    mode: text('mode').notNull().default('ai'),
    assignee: text('assignee'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    priority: text('priority'),
    resolutionOutcome: text('resolution_outcome'),
    lastSignalKind: text('last_signal_kind'),
    lastSignalId: text('last_signal_id'),
    hasPendingEscalation: boolean('has_pending_escalation')
      .notNull()
      .default(false),
    waitingSince: timestamp('waiting_since', { withTimezone: true }),
    unreadCount: integer('unread_count').notNull().default(0),
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
    index('conversations_assignee_status_idx').on(
      table.assignee,
      table.status,
      table.updatedAt,
    ),
    index('conversations_mode_queue_idx')
      .on(table.mode, table.status, table.priority)
      .where(sql`status = 'active'`),
    index('idx_conv_attention').on(table.status, table.mode, table.updatedAt),
    index('idx_conv_resolved').on(table.status, table.updatedAt),
    check(
      'conversations_status_check',
      sql`status IN ('active', 'completed', 'failed')`,
    ),
    check(
      'conversations_type_check',
      sql`conversation_type IN ('message', 'voice')`,
    ),
    check(
      'conversations_mode_check',
      sql`mode IN ('ai', 'human', 'supervised', 'held')`,
    ),
    check(
      'conversations_priority_check',
      sql`priority IS NULL OR priority IN ('low', 'normal', 'high', 'urgent')`,
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

// Per-message feedback (like/dislike) from visitors and staff.

export const messageFeedback = conversationsPgSchema.table(
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
    uniqueIndex('message_feedback_unique_idx').on(
      table.conversationId,
      table.messageId,
      table.userId,
      table.contactId,
    ),
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI pgSchema — memory, evals, workflows, moderation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const aiPgSchema = pgSchema('ai');

/**
 * MemCells — conversation segments detected by boundary detection.
 * Each cell spans a contiguous range of messages in a thread.
 */
export const aiMemCells = aiPgSchema.table(
  'mem_cells',
  {
    id: nanoidPrimaryKey(),
    threadId: text('thread_id').notNull(),
    contactId: text('contact_id'),
    userId: text('user_id'),
    startMessageId: text('start_message_id').notNull(),
    endMessageId: text('end_message_id').notNull(),
    messageCount: integer('message_count').notNull(),
    tokenCount: integer('token_count').notNull(),
    status: text('status').notNull().default('pending'), // pending | processing | ready | error
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('mem_cells_thread_id_idx').on(table.threadId),
    index('mem_cells_contact_status_idx').on(table.contactId, table.status),
    index('mem_cells_user_status_idx').on(table.userId, table.status),
    index('mem_cells_pending_idx')
      .on(table.status)
      .where(sql`status = 'pending'`),
    check(
      'cell_scope_check',
      sql`contact_id IS NOT NULL OR user_id IS NOT NULL`,
    ),
  ],
);

/**
 * Episodes — third-person narrative summaries of conversation segments.
 * Each episode belongs to one MemCell.
 */
export const aiMemEpisodes = aiPgSchema.table(
  'mem_episodes',
  {
    id: nanoidPrimaryKey(),
    cellId: text('cell_id')
      .notNull()
      .references(() => aiMemCells.id, { onDelete: 'cascade' }),
    contactId: text('contact_id'),
    userId: text('user_id'),
    title: text('title').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: embeddingDimensions }),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english', title || ' ' || content)`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('mem_episodes_cell_id_idx').on(table.cellId),
    index('mem_episodes_contact_id_idx').on(table.contactId),
    index('mem_episodes_user_id_idx').on(table.userId),
    index('mem_episodes_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    index('mem_episodes_search_vector_idx').using('gin', table.searchVector),
    check(
      'episode_scope_check',
      sql`contact_id IS NOT NULL OR user_id IS NOT NULL`,
    ),
  ],
);

/**
 * EventLogs — atomic facts extracted from conversation segments.
 * Each fact is a single sentence with explicit attribution.
 */
export const aiMemEventLogs = aiPgSchema.table(
  'mem_event_logs',
  {
    id: nanoidPrimaryKey(),
    cellId: text('cell_id')
      .notNull()
      .references(() => aiMemCells.id, { onDelete: 'cascade' }),
    contactId: text('contact_id'),
    userId: text('user_id'),
    fact: text('fact').notNull(),
    subject: text('subject'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    embedding: vector('embedding', { dimensions: embeddingDimensions }),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english', fact)`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('mem_event_logs_cell_id_idx').on(table.cellId),
    index('mem_event_logs_contact_id_idx').on(table.contactId),
    index('mem_event_logs_user_id_idx').on(table.userId),
    index('mem_event_logs_subject_idx').on(table.subject),
    index('mem_event_logs_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    index('mem_event_logs_search_vector_idx').using('gin', table.searchVector),
    check(
      'event_log_scope_check',
      sql`contact_id IS NOT NULL OR user_id IS NOT NULL`,
    ),
  ],
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
