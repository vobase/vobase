import { nanoidPrimaryKey } from '@vobase/core/schema';
import { sql } from 'drizzle-orm';
import {
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

export const kbPgSchema = pgSchema('kb');

export const kbDocuments = kbPgSchema.table(
  'documents',
  {
    id: nanoidPrimaryKey(),
    title: text('title').notNull(),
    sourceType: text('source_type').notNull().default('upload'), // upload | crawl | google-drive | sharepoint
    sourceId: text('source_id'), // FK to kbSources (cross-module, no .references())
    sourceUrl: text('source_url'),
    mimeType: text('mime_type').notNull().default('text/plain'),
    status: text('status').notNull().default('pending'), // pending | processing | ready | error | needs_ocr
    chunkCount: integer('chunk_count').notNull().default(0),
    metadata: text('metadata'), // JSON
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('documents_source_id_idx').on(table.sourceId),
    index('documents_pending_idx')
      .on(table.status)
      .where(sql`status IN ('pending', 'processing')`),
  ],
);

export const kbChunks = kbPgSchema.table(
  'chunks',
  {
    id: nanoidPrimaryKey(),
    documentId: text('document_id').notNull(), // FK to kbDocuments
    content: text('content').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    tokenCount: integer('token_count').notNull().default(0),
    metadata: text('metadata'), // JSON
    embedding: vector('embedding', { dimensions: 1536 }),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english', content)`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('chunks_document_id_idx').on(table.documentId)],
);

export const kbSources = kbPgSchema.table('sources', {
  id: nanoidPrimaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // crawl | google-drive | sharepoint
  config: text('config'), // JSON - encrypted connector config
  syncSchedule: text('sync_schedule'), // cron expression
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  status: text('status').notNull().default('idle'), // idle | syncing | error
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const kbSyncLogs = kbPgSchema.table(
  'sync_logs',
  {
    id: nanoidPrimaryKey(),
    sourceId: text('source_id').notNull(),
    status: text('status').notNull(), // running | completed | error
    documentsProcessed: integer('documents_processed').notNull().default(0),
    errors: text('errors'), // JSON
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [index('sync_logs_source_id_idx').on(table.sourceId)],
);
