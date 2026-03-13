import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { nanoidPrimaryKey } from '../../lib/schema-helpers';

export const kbDocuments = sqliteTable('kb_documents', {
  id: nanoidPrimaryKey(),
  title: text('title').notNull(),
  sourceType: text('source_type').notNull().default('upload'), // upload | crawl | google-drive | sharepoint
  sourceId: text('source_id'), // FK to kbSources (cross-module, no .references())
  sourceUrl: text('source_url'),
  mimeType: text('mime_type').notNull().default('text/plain'),
  status: text('status').notNull().default('pending'), // pending | processing | ready | error
  chunkCount: integer('chunk_count').notNull().default(0),
  metadata: text('metadata'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
}, (table) => [
  index('kb_documents_source_id_idx').on(table.sourceId),
  index('kb_documents_status_idx').on(table.status),
]);

// IMPORTANT: kb_chunks needs BOTH nanoid `id` (for app logic) AND integer `rowId` (for vec0/FTS5 virtual tables)
// vec0 and FTS5 content_rowid require integer rowids for KNN queries
export const kbChunks = sqliteTable('kb_chunks', {
  id: nanoidPrimaryKey(),
  rowId: integer('row_id').notNull().unique(), // Integer rowid for vec0/FTS5 linkage
  documentId: text('document_id').notNull(), // FK to kbDocuments
  content: text('content').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  tokenCount: integer('token_count').notNull().default(0),
  metadata: text('metadata'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('kb_chunks_document_id_idx').on(table.documentId),
]);

export const kbSources = sqliteTable('kb_sources', {
  id: nanoidPrimaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // crawl | google-drive | sharepoint
  config: text('config'), // JSON - encrypted connector config
  syncSchedule: text('sync_schedule'), // cron expression
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp_ms' }),
  status: text('status').notNull().default('idle'), // idle | syncing | error
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
});

export const kbSyncLogs = sqliteTable('kb_sync_logs', {
  id: nanoidPrimaryKey(),
  sourceId: text('source_id').notNull(),
  status: text('status').notNull(), // running | completed | error
  documentsProcessed: integer('documents_processed').notNull().default(0),
  errors: text('errors'), // JSON
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
}, (table) => [
  index('kb_sync_logs_source_id_idx').on(table.sourceId),
]);
