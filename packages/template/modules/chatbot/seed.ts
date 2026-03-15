import type { VobaseDb } from '@vobase/core';
import { faker } from '@faker-js/faker';
import { chatAssistants, chatThreads, chatMessages } from './schema';

const assistantPersonas = [
  {
    name: 'Vobase Assistant',
    prompt: 'You are a helpful assistant for the Vobase platform. You help users understand the framework, its modules, and how to build applications with it. Be concise and practical.',
    model: 'gpt-5-mini',
    suggestions: ['Help me create a new module', 'Search the knowledge base for', 'Explain how the auth system works', 'Write a Hono route handler that'],
  },
  {
    name: 'Quick Helper',
    prompt: 'You are a fast, lightweight assistant. Answer questions concisely. Prefer short code snippets over long explanations. Skip preamble.',
    model: 'claude-haiku-4-5',
    suggestions: ['Write a TypeScript function that', 'Debug this error', 'Refactor this code to be cleaner', 'What does this code do?'],
  },
];

const sampleConversation = [
  { role: 'user', content: 'How do I create a new module in Vobase?' },
  { role: 'assistant', content: 'To create a new module, add a directory under `modules/` with these files:\n\n```typescript\n// modules/my-module/schema.ts\nimport { sqliteTable, text, integer } from \'drizzle-orm/sqlite-core\';\nimport { nanoidPrimaryKey } from \'../../lib/schema-helpers\';\n\nexport const myTable = sqliteTable(\'my_table\', {\n  id: nanoidPrimaryKey(),\n  name: text(\'name\').notNull(),\n  createdAt: integer(\'created_at\', { mode: \'timestamp_ms\' })\n    .notNull().$defaultFn(() => new Date()),\n});\n```\n\nThen define the module in `index.ts`:\n\n```typescript\nimport { defineModule } from \'@vobase/core\';\nimport * as schema from \'./schema\';\nimport { routes } from \'./handlers\';\n\nexport default defineModule({\n  name: \'my-module\',\n  schema,\n  routes,\n});\n```\n\nRun `bun run db:push` to sync the schema and `bun run generate` to update routes.' },
  { role: 'user', content: 'What about adding background jobs?' },
  { role: 'assistant', content: 'Use `defineJob` from core and add it to your module:\n\n```typescript\n// modules/my-module/jobs.ts\nimport { defineJob } from \'@vobase/core\';\n\nexport const processItem = defineJob(\n  \'my-module:process-item\',\n  async (data: { itemId: string }) => {\n    // Your background logic here\n  }\n);\n```\n\nThen in your module definition:\n\n```typescript\nexport default defineModule({\n  name: \'my-module\',\n  schema,\n  routes,\n  jobs: [processItem],\n});\n```\n\nEnqueue from a handler with `ctx.scheduler.enqueue(\'my-module:process-item\', { itemId })`.' },
];

export function seedChatbot(db: VobaseDb, userId: string): { assistants: number; threads: number } {
  const existing = db.select().from(chatAssistants).limit(1).all();
  if (existing.length > 0) return { assistants: 0, threads: 0 };

  // Seed assistants
  const assistantIds: string[] = [];
  for (const persona of assistantPersonas) {
    const row = db.insert(chatAssistants).values({
      name: persona.name,
      systemPrompt: persona.prompt,
      model: persona.model,
      suggestions: JSON.stringify(persona.suggestions),
      tools: JSON.stringify(['knowledge-base']),
      userId,
      isPublished: true,
    }).returning().get();
    assistantIds.push(row.id);
  }

  // Seed a sample thread with messages
  const threadCreated = faker.date.recent({ days: 7 });
  const thread = db.insert(chatThreads).values({
    title: 'How to create modules',
    assistantId: assistantIds[0],
    userId,
    createdAt: threadCreated,
    updatedAt: threadCreated,
  }).returning().get();

  for (let i = 0; i < sampleConversation.length; i++) {
    const msg = sampleConversation[i];
    const msgTime = new Date(threadCreated.getTime() + (i + 1) * 30_000);
    db.insert(chatMessages).values({
      threadId: thread.id,
      role: msg.role,
      content: msg.content,
      createdAt: msgTime,
    }).run();
  }

  return { assistants: assistantPersonas.length, threads: 1 };
}
