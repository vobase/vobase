import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { nanoidPrimaryKey } from '../../lib/schema-helpers';

export const chatAssistants = sqliteTable('chat_assistants', {
  id: nanoidPrimaryKey(),
  name: text('name').notNull(),
  avatar: text('avatar'),
  systemPrompt: text('system_prompt'),
  tools: text('tools'), // JSON array of tool names
  kbSourceIds: text('kb_source_ids'), // JSON array of KB source IDs to scope search
  model: text('model'), // AI model identifier
  suggestions: text('suggestions'), // JSON array of quick-start prompt strings
  userId: text('user_id').notNull(),
  isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
}, (table) => [
  index('chat_assistants_user_id_idx').on(table.userId),
]);

export const chatThreads = sqliteTable('chat_threads', {
  id: nanoidPrimaryKey(),
  title: text('title'),
  assistantId: text('assistant_id').notNull(),
  userId: text('user_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
}, (table) => [
  index('chat_threads_user_id_idx').on(table.userId),
  index('chat_threads_assistant_id_idx').on(table.assistantId),
]);

export const chatMessages = sqliteTable('chat_messages', {
  id: nanoidPrimaryKey(),
  threadId: text('thread_id').notNull(),
  role: text('role').notNull(), // user | assistant | tool
  content: text('content'),
  toolCalls: text('tool_calls'), // JSON
  toolResults: text('tool_results'), // JSON
  sources: text('sources'), // JSON - citation references
  attachments: text('attachments'), // JSON - storage file references
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('chat_messages_thread_id_idx').on(table.threadId),
]);
