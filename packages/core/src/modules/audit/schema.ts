import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { nanoidPrimaryKey } from '../../db/helpers';

/**
 * Audit log table for tracking system events (sign-in, sign-up, role changes, etc.)
 * Events are immutable - no updatedAt column
 */
export const auditLog = sqliteTable('_audit_log', {
  id: nanoidPrimaryKey(),
  event: text('event').notNull(),
  actorId: text('actor_id'),
  actorEmail: text('actor_email'),
  ip: text('ip'),
  details: text('details'), // JSON string
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Record audits table for tracking changes to individual records
 * Stores before/after data for data change auditing
 */
export const recordAudits = sqliteTable('_record_audits', {
  id: nanoidPrimaryKey(),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  oldData: text('old_data'), // JSON string
  newData: text('new_data'), // JSON string
  changedBy: text('changed_by'), // user ID
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});
