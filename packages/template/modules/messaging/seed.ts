import { faker } from '@faker-js/faker';
import type { VobaseDb } from '@vobase/core';

import type { SeedContext } from '../seed-types';
import { msgAgents, msgMessages, msgThreads } from './schema';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const agentPersonas = [
  {
    name: 'Vobase Assistant',
    prompt:
      'You are a helpful assistant for the Vobase platform. You help users understand the framework, its modules, and how to build applications with it. Be concise and practical.',
    model: 'gpt-5-mini',
    suggestions: [
      'Help me create a new module',
      'Search the knowledge base for',
      'Explain how the auth system works',
      'Write a Hono route handler that',
    ],
  },
  {
    name: 'Quick Helper',
    prompt:
      'You are a fast, lightweight assistant. Answer questions concisely. Prefer short code snippets over long explanations. Skip preamble.',
    model: 'claude-haiku-4-5',
    suggestions: [
      'Write a TypeScript function that',
      'Debug this error',
      'Refactor this code to be cleaner',
      'What does this code do?',
    ],
  },
];

const sampleConversation = [
  {
    direction: 'inbound',
    senderType: 'user',
    aiRole: 'user',
    content: 'How do I create a new module in Vobase?',
  },
  {
    direction: 'outbound',
    senderType: 'agent',
    aiRole: 'assistant',
    content:
      "To create a new module, add a directory under `modules/` with these files:\n\n```typescript\n// modules/my-module/schema.ts\nimport { pgTable, text, integer } from 'drizzle-orm/pg-core';\nimport { nanoidPrimaryKey } from '@vobase/core';\n\nexport const myTable = pgTable('my_table', {\n  id: nanoidPrimaryKey(),\n  name: text('name').notNull(),\n  createdAt: timestamp('created_at', { withTimezone: true })\n    .notNull().defaultNow(),\n});\n```\n\nThen define the module in `index.ts`:\n\n```typescript\nimport { defineModule } from '@vobase/core';\nimport * as schema from './schema';\nimport { routes } from './handlers';\n\nexport default defineModule({\n  name: 'my-module',\n  schema,\n  routes,\n});\n```\n\nRun `bun run db:push` to sync the schema and `bun run generate` to update routes.",
  },
  {
    direction: 'inbound',
    senderType: 'user',
    aiRole: 'user',
    content: 'What about adding background jobs?',
  },
  {
    direction: 'outbound',
    senderType: 'agent',
    aiRole: 'assistant',
    content:
      "Use `defineJob` from core and add it to your module:\n\n```typescript\n// modules/my-module/jobs.ts\nimport { defineJob } from '@vobase/core';\n\nexport const processItem = defineJob(\n  'my-module:process-item',\n  async (data: { itemId: string }) => {\n    // Your background logic here\n  }\n);\n```\n\nThen in your module definition:\n\n```typescript\nexport default defineModule({\n  name: 'my-module',\n  schema,\n  routes,\n  jobs: [processItem],\n});\n```\n\nEnqueue from a handler with `ctx.scheduler.enqueue('my-module:process-item', { itemId })`.",
  },
];

export default async function seed({ db, userId }: SeedContext): Promise<void> {
  const msgResult = await seedMessaging(db, userId);
  if (msgResult.agents > 0) {
    console.log(
      green('✓') +
        ` Created ${msgResult.agents} messaging agents + ${msgResult.threads} sample thread with messages`,
    );
  } else {
    console.log(dim('✓ Messaging data already exists. Skipping.'));
  }
}

export async function seedMessaging(
  db: VobaseDb,
  userId: string,
): Promise<{ agents: number; threads: number }> {
  const existing = await db.select().from(msgAgents).limit(1);
  if (existing.length > 0) return { agents: 0, threads: 0 };

  // Seed agents
  const agentIds: string[] = [];
  for (const persona of agentPersonas) {
    const [row] = await db
      .insert(msgAgents)
      .values({
        name: persona.name,
        systemPrompt: persona.prompt,
        model: persona.model,
        suggestions: JSON.stringify(persona.suggestions),
        tools: JSON.stringify(['knowledge-base']),
        channels: JSON.stringify(['web']),
        userId,
        isPublished: true,
      })
      .returning();
    agentIds.push(row.id);
  }

  // Seed a sample thread with messages
  const threadCreated = faker.date.recent({ days: 7 });
  const [thread] = await db
    .insert(msgThreads)
    .values({
      title: 'How to create modules',
      agentId: agentIds[0],
      userId,
      createdAt: threadCreated,
      updatedAt: threadCreated,
    })
    .returning();

  for (let i = 0; i < sampleConversation.length; i++) {
    const msg = sampleConversation[i];
    const msgTime = new Date(threadCreated.getTime() + (i + 1) * 30_000);
    await db.insert(msgMessages).values({
      threadId: thread.id,
      direction: msg.direction,
      senderType: msg.senderType,
      aiRole: msg.aiRole,
      content: msg.content,
      createdAt: msgTime,
    });
  }

  return { agents: agentPersonas.length, threads: 1 };
}
