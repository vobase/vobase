import { index, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

import { infraPgSchema } from '../db/pg-schemas'

export const webhookDedup = infraPgSchema.table(
  'webhook_dedup',
  {
    id: text('id').notNull(),
    source: text('source').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.source] }),
    index('webhook_dedup_received_at_idx').on(table.receivedAt),
  ],
)
