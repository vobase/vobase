import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { nanoidPrimaryKey, DEFAULT_COLUMNS } from './helpers';

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
 * Sequences table for managing sequential ID generation per prefix
 * Used for human-readable sequence-based IDs (e.g., ORD-001, INV-002)
 */
export const sequences = sqliteTable('_sequences', {
  id: nanoidPrimaryKey(),
  prefix: text('prefix').notNull().unique(),
  currentValue: integer('current_value').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
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
