import { nanoidPrimaryKey } from '@vobase/core/schema';
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  jsonb,
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

export const kbSources = kbPgSchema.table(
  'sources',
  {
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
  },
  (table) => [
    index('sources_status_idx').on(table.status),
    check(
      'sources_type_check',
      sql`type IN ('crawl', 'google-drive', 'sharepoint')`,
    ),
    check('sources_status_check', sql`status IN ('idle', 'syncing', 'error')`),
  ],
);

export const kbDocuments = kbPgSchema.table(
  'documents',
  {
    id: nanoidPrimaryKey(),
    title: text('title').notNull(),
    folder: text('folder'), // null = root level, e.g. 'policies', 'services'
    sourceType: text('source_type').notNull().default('upload'), // upload | crawl | google-drive | sharepoint
    sourceId: text('source_id').references(() => kbSources.id, {
      onDelete: 'set null',
    }),
    sourceUrl: text('source_url'),
    mimeType: text('mime_type').notNull().default('text/plain'),
    status: text('status').notNull().default('pending'), // pending | processing | ready | error | needs_ocr
    chunkCount: integer('chunk_count').notNull().default(0),
    metadata: text('metadata'), // JSON
    content: jsonb('content'), // Plate Value (JSON AST)
    rawContent: jsonb('raw_content'), // immutable original extraction
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
    index('documents_folder_idx').on(table.folder),
    index('documents_pending_idx')
      .on(table.status)
      .where(sql`status IN ('pending', 'processing')`),
    check(
      'documents_status_check',
      sql`status IN ('pending', 'processing', 'ready', 'error', 'needs_ocr')`,
    ),
    check(
      'documents_source_type_check',
      sql`source_type IN ('upload', 'crawl', 'google-drive', 'sharepoint')`,
    ),
  ],
);

export const kbChunks = kbPgSchema.table(
  'chunks',
  {
    id: nanoidPrimaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => kbDocuments.id, { onDelete: 'cascade' }),
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
  (table) => [
    index('chunks_document_id_idx').on(table.documentId),
    index('chunks_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    index('chunks_search_vector_idx').using('gin', table.searchVector),
  ],
);

export const kbSyncLogs = kbPgSchema.table(
  'sync_logs',
  {
    id: nanoidPrimaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => kbSources.id, { onDelete: 'cascade' }),
    status: text('status').notNull(), // running | completed | error
    documentsProcessed: integer('documents_processed').notNull().default(0),
    errors: text('errors'), // JSON
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('sync_logs_source_id_idx').on(table.sourceId),
    check(
      'sync_logs_status_check',
      sql`status IN ('running', 'completed', 'error')`,
    ),
  ],
);
