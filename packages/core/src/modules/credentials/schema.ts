import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const credentialsTable = sqliteTable('_credentials', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});
