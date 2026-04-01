/**
 * Mastra singleton — central registry for agents, tools, workflows, and memory.
 *
 * Initialized lazily via initMastra() called from the AI module init hook,
 * after setAiModuleDeps() has wired the db and scheduler.
 */
import { Mastra } from '@mastra/core';
import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';

import { getMastraAgents } from './agents';
import { scorers } from './evals/scorers';
import {
  bookSlotTool,
  cancelBookingTool,
  checkAvailabilityTool,
  consultHumanTool,
  rescheduleBookingTool,
  searchKnowledgeBaseTool,
  sendReminderTool,
} from './tools';
import { conversationLifecycleWorkflow } from './workflows/session-lifecycle';

let mastraInstance: Mastra | undefined;
let memoryInstance: Memory | undefined;

/**
 * Initialize the Mastra singleton with storage from the vobase db connection.
 * Called from the AI module init hook after setAiModuleDeps().
 */
export async function initMastra(_db: { $client: unknown }): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is required');

  const store = new PostgresStore({
    id: 'vobase-pg',
    connectionString: dbUrl,
  });

  await store.init();

  memoryInstance = new Memory({
    storage: store,
    options: {
      lastMessages: 20,
      semanticRecall: false, // EverMemOS handles long-term recall
      workingMemory: { enabled: true },
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
      consult_human: consultHumanTool,
    },
    workflows: {
      'ai:conversation-lifecycle': conversationLifecycleWorkflow,
    },
    memory: { 'agent-memory': memoryInstance },
    storage: store,
    scorers: Object.fromEntries(scorers.map((s) => [s.id, s])),
  });

  // Wire memory to agents after Mastra init — agents are static singletons
  // created before Mastra, so memory must be set post-init via __setMemory.
  const agents = getMastraAgents();
  for (const agent of Object.values(agents)) {
    agent.__setMemory(memoryInstance);
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
