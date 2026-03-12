import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { nanoidPrimaryKey } from '../../db/helpers';

export const sequences = sqliteTable('_sequences', {
  id: nanoidPrimaryKey(),
  prefix: text('prefix').notNull().unique(),
  currentValue: integer('current_value').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});
