import { nanoidPrimaryKey } from '@vobase/core/schema';
import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Re-export memory tables so they're part of the messaging module schema
export {
  msgMemCells,
  msgMemEpisodes,
  msgMemEventLogs,
} from './lib/memory/schema';

export const msgAgents = pgTable(
  'msg_agents',
  {
    id: nanoidPrimaryKey(),
    name: text('name').notNull(),
    avatar: text('avatar'),
    systemPrompt: text('system_prompt'),
    tools: text('tools'), // JSON array of tool names
    kbSourceIds: text('kb_source_ids'), // JSON array of KB source IDs to scope search
    model: text('model'), // AI model identifier
    suggestions: text('suggestions'), // JSON array of quick-start prompt strings
    channels: text('channels'), // JSON array of channel names (e.g. ["web", "whatsapp"])
    userId: text('user_id').notNull(),
    isPublished: boolean('is_published').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('msg_agents_user_id_idx').on(table.userId)],
);

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

export const msgMessages = pgTable(
  'msg_messages',
  {
    id: nanoidPrimaryKey(),
    threadId: text('thread_id').notNull(),
    direction: text('direction').notNull().default('inbound'),
    senderType: text('sender_type').notNull().default('user'),
    aiRole: text('ai_role'), // 'user' | 'assistant' | 'tool' — set on write for AI SDK compat
    content: text('content'),
    toolCalls: text('tool_calls'), // JSON
    toolResults: text('tool_results'), // JSON
    sources: text('sources'), // JSON - citation references
    attachments: text('attachments'), // JSON - storage file references
    externalMessageId: text('external_message_id').unique(),
    status: text('status').default('sent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('msg_messages_thread_id_idx').on(table.threadId),
    index('msg_messages_external_id_idx').on(table.externalMessageId),
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
