import { nanoidPrimaryKey } from '@vobase/core/schema';
import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const msgThreads = pgTable(
  'msg_threads',
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
    index('msg_threads_user_id_idx').on(table.userId),
    index('msg_threads_agent_id_idx').on(table.agentId),
    index('msg_threads_contact_id_idx').on(table.contactId),
  ],
);

/**
 * Outbound message delivery tracking.
 * Conversation content lives in Mastra Memory; this table tracks the delivery
 * lifecycle (queued → sent → delivered → read → failed) for outbound channel messages.
 */
export const msgOutbox = pgTable(
  'msg_outbox',
  {
    id: nanoidPrimaryKey(),
    threadId: text('thread_id').notNull(),
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
    index('msg_outbox_thread_id_idx').on(table.threadId),
    index('msg_outbox_external_id_idx').on(table.externalMessageId),
    index('msg_outbox_status_idx').on(table.status),
  ],
);

export const msgContacts = pgTable('msg_contacts', {
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
