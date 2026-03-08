import { customAlphabet } from 'nanoid';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const createNanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

const nanoidPrimaryKey = () => text('id').primaryKey().$defaultFn(() => createNanoid());

export const auditLog = sqliteTable('_audit_log', {
  id: nanoidPrimaryKey(),
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
  id: nanoidPrimaryKey(),
  prefix: text('prefix').notNull().unique(),
  currentValue: integer('current_value').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const recordAudits = sqliteTable('_record_audits', {
  id: nanoidPrimaryKey(),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  oldData: text('old_data'),
  newData: text('new_data'),
  changedBy: text('changed_by'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});
