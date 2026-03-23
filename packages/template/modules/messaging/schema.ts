import { nanoidPrimaryKey } from '@vobase/core/schema';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const messagingPgSchema = pgSchema('messaging');

export const msgThreads = messagingPgSchema.table(
  'threads',
  {
    id: nanoidPrimaryKey(),
    title: text('title'),
    agentId: text('agent_id'),
    userId: text('user_id'),
    contactId: text('contact_id'),
    channel: text('channel').notNull().default('web'),
    status: text('status').notNull().default('ai'),
    aiPausedAt: timestamp('ai_paused_at', { withTimezone: true }),
    aiResumeAt: timestamp('ai_resume_at', { withTimezone: true }),
    windowExpiresAt: timestamp('window_expires_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('threads_user_id_idx').on(table.userId),
    index('threads_agent_id_idx').on(table.agentId),
    index('threads_contact_id_idx').on(table.contactId),
    index('threads_user_channel_idx').on(table.userId, table.channel),
    index('threads_status_idx').on(table.status),
    check('threads_status_check', sql`status IN ('ai', 'human', 'closed')`),
  ],
);

/**
 * Outbound message delivery tracking.
 * Conversation content lives in Mastra Memory; this table tracks the delivery
 * lifecycle (queued → sent → delivered → read → failed) for outbound channel messages.
 */
export const msgOutbox = messagingPgSchema.table(
  'outbox',
  {
    id: nanoidPrimaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => msgThreads.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    channel: text('channel').notNull().default('web'),
    externalMessageId: text('external_message_id').unique(),
    status: text('status').notNull().default('queued'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('outbox_thread_id_idx').on(table.threadId),
    index('outbox_external_id_idx').on(table.externalMessageId),
    index('outbox_queued_idx').on(table.status).where(sql`status = 'queued'`),
    check(
      'outbox_status_check',
      sql`status IN ('queued', 'sent', 'delivered', 'read', 'failed')`,
    ),
  ],
);

export const msgContacts = messagingPgSchema.table('contacts', {
  id: nanoidPrimaryKey(),
  phone: text('phone').unique(),
  email: text('email').unique(),
  name: text('name'),
  channel: text('channel'),
  metadata: text('metadata'), // JSON
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
