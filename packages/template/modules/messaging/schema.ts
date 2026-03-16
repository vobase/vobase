import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { nanoidPrimaryKey } from '../../lib/schema-helpers';

export const msgAgents = sqliteTable('msg_agents', {
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
  isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
}, (table) => [
  index('msg_agents_user_id_idx').on(table.userId),
]);

export const msgThreads = sqliteTable('msg_threads', {
  id: nanoidPrimaryKey(),
  title: text('title'),
  agentId: text('agent_id'),
  userId: text('user_id'),
  contactId: text('contact_id'),
  channel: text('channel').notNull().default('web'),
  status: text('status').notNull().default('ai'),
  aiPausedAt: integer('ai_paused_at', { mode: 'timestamp_ms' }),
  aiResumeAt: integer('ai_resume_at', { mode: 'timestamp_ms' }),
  windowExpiresAt: integer('window_expires_at', { mode: 'timestamp_ms' }),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
}, (table) => [
  index('msg_threads_user_id_idx').on(table.userId),
  index('msg_threads_agent_id_idx').on(table.agentId),
  index('msg_threads_contact_id_idx').on(table.contactId),
]);

export const msgMessages = sqliteTable('msg_messages', {
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
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('msg_messages_thread_id_idx').on(table.threadId),
  index('msg_messages_external_id_idx').on(table.externalMessageId),
]);

export const msgContacts = sqliteTable('msg_contacts', {
  id: nanoidPrimaryKey(),
  phone: text('phone').unique(),
  email: text('email').unique(),
  name: text('name'),
  channel: text('channel'),
  metadata: text('metadata'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
});
