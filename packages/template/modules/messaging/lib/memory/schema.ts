import { nanoidPrimaryKey } from '@vobase/core/schema';
import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  pgTable,
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
export const msgMemCells = pgTable(
  'msg_mem_cells',
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
    index('msg_mem_cells_thread_id_idx').on(table.threadId),
    index('msg_mem_cells_contact_status_idx').on(table.contactId, table.status),
    index('msg_mem_cells_user_status_idx').on(table.userId, table.status),
    index('msg_mem_cells_status_idx').on(table.status),
  ],
);

/**
 * Episodes — third-person narrative summaries of conversation segments.
 * Each episode belongs to one MemCell.
 */
export const msgMemEpisodes = pgTable(
  'msg_mem_episodes',
  {
    id: nanoidPrimaryKey(),
    cellId: text('cell_id').notNull(),
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
    index('msg_mem_episodes_cell_id_idx').on(table.cellId),
    index('msg_mem_episodes_contact_id_idx').on(table.contactId),
    index('msg_mem_episodes_user_id_idx').on(table.userId),
    index('msg_mem_episodes_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    index('msg_mem_episodes_search_vector_idx').using(
      'gin',
      table.searchVector,
    ),
  ],
);

/**
 * EventLogs — atomic facts extracted from conversation segments.
 * Each fact is a single sentence with explicit attribution.
 */
export const msgMemEventLogs = pgTable(
  'msg_mem_event_logs',
  {
    id: nanoidPrimaryKey(),
    cellId: text('cell_id').notNull(),
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
    index('msg_mem_event_logs_cell_id_idx').on(table.cellId),
    index('msg_mem_event_logs_contact_id_idx').on(table.contactId),
    index('msg_mem_event_logs_user_id_idx').on(table.userId),
    index('msg_mem_event_logs_subject_idx').on(table.subject),
    index('msg_mem_event_logs_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    index('msg_mem_event_logs_search_vector_idx').using(
      'gin',
      table.searchVector,
    ),
  ],
);
