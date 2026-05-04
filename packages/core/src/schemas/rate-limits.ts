import { index, integer, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

import { infraPgSchema } from '../db/pg-schemas'

/**
 * Sliding-window rate-limit ledger.
 *
 * One row per `(key, hitAt)` event. The limiter prunes rows older than the
 * window before counting, so the table stays bounded by `limit` per key.
 *
 * `hitAt` uses Postgres `now()` (set by the limiter, not the caller) so
 * clock-drift on the application host can't poison the window. The composite
 * primary key includes a sequence column so two hits in the same microsecond
 * don't collide.
 */
export const rateLimits = infraPgSchema.table(
  'rate_limits',
  {
    key: text('key').notNull(),
    hitAt: timestamp('hit_at', { withTimezone: true }).notNull(),
    seq: integer('seq').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.hitAt, table.seq] }),
    index('rate_limits_key_hit_at_idx').on(table.key, table.hitAt),
  ],
)
