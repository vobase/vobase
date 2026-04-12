/**
 * Mastra singleton — central registry for agents, tools, workflows, and memory.
 *
 * Initialized lazily via initMastra() called from the AI module init hook,
 * after setAiModuleDeps() has wired the db and scheduler.
 */
import { openai } from '@ai-sdk/openai';
import { Mastra } from '@mastra/core';
import { MastraCompositeStore } from '@mastra/core/storage';
import { Memory } from '@mastra/memory';
import { PgVector, PostgresStore } from '@mastra/pg';
import type { VobaseDb } from '@vobase/core';
import { z } from 'zod';

import { getMastraAgents } from './agents';
import { buildCustomScorer } from './evals/custom-scorer-factory';
import { scorers } from './evals/scorers';
import { models } from './lib/models';
import { VobaseMemoryStorage } from './storage/vobase-memory';
import {
  bookSlotTool,
  cancelBookingTool,
  checkAvailabilityTool,
  rescheduleBookingTool,
  searchKnowledgeBaseTool,
  sendReminderTool,
} from './tools';

/**
 * Working memory schema for the booking domain.
 * The agent updates this structured data via tool calls during a conversation.
 * Stored per-resource (contact) and persisted across threads.
 */
const contactWorkingMemorySchema = z.object({
  customerName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  preferredTimes: z.array(z.string()).optional(),
  servicePreferences: z.array(z.string()).optional(),
  bookingHistory: z
    .array(
      z.object({
        date: z.string(),
        service: z.string(),
        status: z.enum(['completed', 'cancelled', 'no-show']),
      }),
    )
    .optional(),
  notes: z.string().optional(),
  language: z.string().optional(),
  lastConversationSummary: z.string().optional(),
});

let mastraInstance: Mastra | undefined;
let memoryInstance: Memory | undefined;

/**
 * Initialize the Mastra singleton with storage from the vobase db connection.
 * Called from the AI module init hook after setAiModuleDeps().
 *
 * Memory domain routes to VobaseMemoryStorage (conversations schema),
 * everything else (workflows, observability) uses PostgresStore.
 */
export async function initMastra(db: { $client: unknown }): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is required');

  const pgStore = new PostgresStore({
    id: 'vobase-pg',
    connectionString: dbUrl,
    schemaName: 'mastra',
  });

  await pgStore.init();

  // OM methods delegate to PostgresStore's MemoryPG — must exist after init()
  const omDelegate = pgStore.stores.memory;
  if (!omDelegate)
    throw new Error('PostgresStore did not initialize memory domain');

  const vobaseMemory = new VobaseMemoryStorage(db as VobaseDb, omDelegate);

  const compositeStore = new MastraCompositeStore({
    id: 'vobase-composite',
    default: pgStore,
    domains: {
      memory: vobaseMemory,
    },
  });

  const pgVector = new PgVector({
    connectionString: dbUrl,
    id: 'vobase-vectors',
  });

  memoryInstance = new Memory({
    storage: compositeStore,
    vector: pgVector,
    embedder: openai.embedding('text-embedding-3-small'),
    options: {
      lastMessages: 20,
      semanticRecall: {
        topK: 5,
        messageRange: { before: 1, after: 1 },
      },
      workingMemory: {
        enabled: true,
        schema: contactWorkingMemorySchema,
      },
      observationalMemory: {
        enabled: true,
        model: models.gemini_flash,
        scope: 'resource',
      },
    },
  });

  mastraInstance = new Mastra({
    agents: getMastraAgents(),
    tools: {
      search_knowledge_base: searchKnowledgeBaseTool,
      check_availability: checkAvailabilityTool,
      book_slot: bookSlotTool,
      cancel_booking: cancelBookingTool,
      reschedule_booking: rescheduleBookingTool,
      send_reminder: sendReminderTool,
    },
    workflows: {},
    memory: { 'agent-memory': memoryInstance },
    storage: compositeStore,
    scorers: Object.fromEntries(scorers.map((s) => [s.id, s])),
  });

  // Wire memory to agents after Mastra init — agents are static singletons
  // created before Mastra, so memory must be set post-init via __setMemory.
  const agents = getMastraAgents();
  for (const agent of Object.values(agents)) {
    agent.__setMemory(memoryInstance);
  }

  // Load published custom scorer definitions from Mastra storage and register
  // them on the instance so they participate in live scoring alongside code scorers.
  try {
    const scorerDefsStore = await compositeStore.getStore('scorerDefinitions');
    if (scorerDefsStore) {
      const result = (await scorerDefsStore.listResolved()) as Record<
        string,
        unknown
      >;
      const rawDefs = Array.isArray(result?.scorerDefinitions)
        ? (result.scorerDefinitions as Record<string, unknown>[])
        : [];
      const defs = rawDefs.filter((d) => d.status === 'published');
      for (const def of defs) {
        const metadata = (def.metadata ?? {}) as Record<string, unknown>;
        const scorer = buildCustomScorer({
          id: def.id as string,
          name: (def.name as string) ?? '',
          description: (def.description as string) ?? '',
          criteria: (def.instructions as string) ?? '',
          model: (metadata.model as string) ?? 'gpt-5.4',
        });
        mastraInstance.addScorer(scorer);
      }
    }
  } catch {
    // Scorer definitions table may not exist on first boot — safe to skip
  }
}

/** Get the Mastra singleton. Throws if not initialized. */
export function getMastra(): Mastra {
  if (!mastraInstance)
    throw new Error('Mastra not initialized — call initMastra() first');
  return mastraInstance;
}

/** Get the Memory instance. Throws if not initialized. */
export function getMemory(): Memory {
  if (!memoryInstance)
    throw new Error('Memory not initialized — call initMastra() first');
  return memoryInstance;
}
