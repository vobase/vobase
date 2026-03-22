import type { VobaseDb } from '@vobase/core';

import { initMastra } from '../../mastra';
import { getDefaultAgent } from '../../mastra/agents';
import type { SeedContext } from '../seed-types';
import { createMemoryThread, saveInboundMessage } from './lib/memory-bridge';
import { msgThreads } from './schema';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export default async function seed({ db, userId }: SeedContext): Promise<void> {
  const msgResult = await seedMessaging(db, userId);
  if (msgResult.threads > 0) {
    console.log(green('✓') + ` Created ${msgResult.threads} sample thread`);
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

  const registered = getDefaultAgent();
  if (!registered) return { threads: 0 };
  const defaultAgent = registered.meta;

  // Seed a sample thread with Drizzle metadata
  const [thread] = await db
    .insert(msgThreads)
    .values({
      title: 'How to create modules',
      agentId: defaultAgent.id,
      userId,
    })
    .returning();

  // Initialize Mastra Memory (needed for seed context where server hasn't started)
  try {
    await initMastra(db as unknown as { $client: unknown });
  } catch {
    // Already initialized or storage not available — continue
  }

  // Create corresponding Mastra Memory thread and seed sample messages
  try {
    await createMemoryThread({
      threadId: thread.id,
      resourceId: userId,
      title: 'How to create modules',
    });

    await saveInboundMessage({
      threadId: thread.id,
      resourceId: userId,
      content: 'How do I create a new module in Vobase?',
      role: 'user',
    });

    await saveInboundMessage({
      threadId: thread.id,
      resourceId: userId,
      content:
        'To create a new module, add a directory under `modules/` with these files:\n\n' +
        '- `schema.ts` — Drizzle table definitions\n' +
        '- `handlers.ts` — Hono route handlers\n' +
        '- `index.ts` — `defineModule()` with name, schema, routes\n' +
        '- `pages/` — React components (optional)\n' +
        '- `jobs.ts` — Background tasks (optional)\n' +
        '- `seed.ts` — Seed data (optional)\n\n' +
        'Then register the module in `vobase.config.ts` under the `modules` array.',
      role: 'assistant',
    });
  } catch {
    // Memory not initialized during seed — non-fatal
  }

  return { threads: 1 };
}
