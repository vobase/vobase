import { integer, text, timestamp } from 'drizzle-orm/pg-core';

import { nanoidPrimaryKey } from '../db/helpers';
import { infraPgSchema } from '../db/pg-schemas';

export const sequences = infraPgSchema.table('sequences', {
  id: nanoidPrimaryKey(),
  prefix: text('prefix').notNull().unique(),
  currentValue: integer('current_value').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
