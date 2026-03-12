/**
 * Combined schema barrel for drizzle-kit.
 *
 * drizzle-kit runs under Node.js and cannot import @vobase/core (which uses bun:sqlite).
 * This file re-declares the core built-in table schemas locally so that `bun run db:push`
 * and `bun run db:generate` can see all tables.
 *
 * User module schemas are auto-included via the glob in drizzle.config.ts.
 */
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { customAlphabet } from 'nanoid';

const createNanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
const nanoidPrimaryKey = () => text('id').primaryKey().$defaultFn(() => createNanoid());

// === Auth tables (managed by better-auth) ===

export const authUser = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  role: text('role').notNull().default('user'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
});

export const authSession = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
}, (table) => [index('session_user_id_idx').on(table.userId)]);

export const authAccount = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
}, (table) => [index('account_user_id_idx').on(table.userId)]);

export const authVerification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
}, (table) => [index('verification_identifier_idx').on(table.identifier)]);

// === Built-in module tables ===

export const auditLog = sqliteTable('_audit_log', {
  id: nanoidPrimaryKey(),
  event: text('event').notNull(),
  actorId: text('actor_id'),
  actorEmail: text('actor_email'),
  ip: text('ip'),
  details: text('details'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
});

export const recordAudits = sqliteTable('_record_audits', {
  id: nanoidPrimaryKey(),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  oldData: text('old_data'),
  newData: text('new_data'),
  changedBy: text('changed_by'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
});

export const sequences = sqliteTable('_sequences', {
  id: nanoidPrimaryKey(),
  prefix: text('prefix').notNull().unique(),
  currentValue: integer('current_value').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
});

export const webhookDedup = sqliteTable('_webhook_dedup', {
  id: text('id').notNull(),
  source: text('source').notNull(),
  receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (table) => [primaryKey({ columns: [table.id, table.source] })]);
