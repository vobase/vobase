import { primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { infraPgSchema } from '../db/pg-schemas';

/**
 * Webhook deduplication table. Tracks processed webhook IDs
 * to prevent duplicate processing.
 */
export const webhookDedup = infraPgSchema.table(
  'webhook_dedup',
  {
    id: text('id').notNull(),
    source: text('source').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.id, table.source] })],
);
