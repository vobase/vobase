import { faker } from '@faker-js/faker';
import type { VobaseDb } from '@vobase/core';

import { getDefaultAgent } from '../ai/agents';
import type { SeedContext } from '../seed-types';
import { msgMessages, msgThreads } from './schema';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

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
  if (msgResult.threads > 0) {
    console.log(
      green('✓') + ` Created ${msgResult.threads} sample thread with messages`,
    );
  } else {
    console.log(dim('✓ Messaging data already exists. Skipping.'));
  }
}

export async function seedMessaging(
  db: VobaseDb,
  userId: string,
): Promise<{ threads: number }> {
  const existing = await db.select().from(msgThreads).limit(1);
  if (existing.length > 0) return { threads: 0 };

  // Use the default code-defined agent
  const defaultAgent = getDefaultAgent();
  if (!defaultAgent) return { threads: 0 };

  // Seed a sample thread with messages
  const threadCreated = faker.date.recent({ days: 7 });
  const [thread] = await db
    .insert(msgThreads)
    .values({
      title: 'How to create modules',
      agentId: defaultAgent.id,
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

  return { threads: 1 };
}
