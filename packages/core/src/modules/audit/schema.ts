import { text, timestamp } from 'drizzle-orm/pg-core';

import { nanoidPrimaryKey } from '../../db/helpers';
import { auditPgSchema } from '../../db/pg-schemas';

/**
 * Audit log table for tracking system events (sign-in, sign-up, role changes, etc.)
 * Events are immutable - no updatedAt column
 */
export const auditLog = auditPgSchema.table('audit_log', {
  id: nanoidPrimaryKey(),
  event: text('event').notNull(),
  actorId: text('actor_id'),
  actorEmail: text('actor_email'),
  ip: text('ip'),
  details: text('details'), // JSON string
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Record audits table for tracking changes to individual records
 * Stores before/after data for data change auditing
 */
export const recordAudits = auditPgSchema.table('record_audits', {
  id: nanoidPrimaryKey(),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  oldData: text('old_data'), // JSON string
  newData: text('new_data'), // JSON string
  changedBy: text('changed_by'), // user ID
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
