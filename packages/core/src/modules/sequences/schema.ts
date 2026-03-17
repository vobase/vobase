import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { nanoidPrimaryKey } from '../../db/helpers';

export const sequences = pgTable('_sequences', {
  id: nanoidPrimaryKey(),
  prefix: text('prefix').notNull().unique(),
  currentValue: integer('current_value').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
