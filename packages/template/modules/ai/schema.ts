import { nanoidPrimaryKey } from '@vobase/core/schema';
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  vector,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// Hardcoded to match KB schema — change requires a migration anyway
const embeddingDimensions = 1536;

/**
 * MemCells — conversation segments detected by boundary detection.
 * Each cell spans a contiguous range of messages in a thread.
 */
export const aiPgSchema = pgSchema('ai');

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
