import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { nanoidPrimaryKey } from '../../db/helpers';

export const notifyLog = sqliteTable(
  '_notify_log',
  {
    id: nanoidPrimaryKey(),
    channel: text('channel').notNull(),
    provider: text('provider').notNull(),
    to: text('to').notNull(),
    subject: text('subject'),
    template: text('template'),
    providerMessageId: text('provider_message_id'),
    status: text('status').notNull().default('sent'),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('notify_log_channel_idx').on(table.channel),
    index('notify_log_status_idx').on(table.status),
  ],
);

export const notifySchema = { notifyLog };
