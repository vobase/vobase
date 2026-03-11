// System table schemas for drizzle-kit introspection.
// These mirror the tables created by ensureCoreTables() at startup.
// Defined locally to avoid importing @vobase/core (which uses bun:sqlite)
// during drizzle-kit push/generate (which runs under Node.js).

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const auditLog = sqliteTable('_audit_log', {
  id: text('id').primaryKey(),
  event: text('event').notNull(),
  actorId: text('actor_id'),
  actorEmail: text('actor_email'),
  ip: text('ip'),
  details: text('details'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sequences = sqliteTable('_sequences', {
  id: text('id').primaryKey(),
  prefix: text('prefix').notNull().unique(),
  currentValue: integer('current_value').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const recordAudits = sqliteTable('_record_audits', {
  id: text('id').primaryKey(),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  oldData: text('old_data'),
  newData: text('new_data'),
  changedBy: text('changed_by'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});
