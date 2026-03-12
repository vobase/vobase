import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Webhook deduplication table. Tracks processed webhook IDs
 * to prevent duplicate processing.
 */
export const webhookDedup = sqliteTable(
  '_webhook_dedup',
  {
    id: text('id').notNull(),
    source: text('source').notNull(),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.id, table.source] })],
);
