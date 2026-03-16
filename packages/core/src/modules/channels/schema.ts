import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { nanoidPrimaryKey } from '../../db/helpers';

export const channelsLog = sqliteTable(
  '_channels_log',
  {
    id: nanoidPrimaryKey(),
    channel: text('channel').notNull(),
    direction: text('direction').notNull(), // 'inbound' | 'outbound'
    to: text('to').notNull(),
    from: text('from'),
    messageId: text('message_id'),
    status: text('status').notNull().default('sent'),
    content: text('content'),
    error: text('error'),
    metadata: text('metadata'), // JSON
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('channels_log_channel_idx').on(table.channel),
    index('channels_log_direction_idx').on(table.direction),
    index('channels_log_status_idx').on(table.status),
  ],
);

export const channelsTemplates = sqliteTable(
  '_channels_templates',
  {
    id: nanoidPrimaryKey(),
    channel: text('channel').notNull(),
    externalId: text('external_id').unique(),
    name: text('name').notNull(),
    language: text('language').notNull(),
    category: text('category'),
    status: text('status'),
    components: text('components'), // JSON
    syncedAt: integer('synced_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('channels_templates_channel_idx').on(table.channel),
    index('channels_templates_name_idx').on(table.name),
  ],
);

export const channelsSchema = { channelsLog, channelsTemplates };
