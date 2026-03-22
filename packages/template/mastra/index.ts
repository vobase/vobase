/**
 * Mastra singleton — central registry for agents, tools, workflows, and memory.
 *
 * Initialized lazily via initMastra() called from the AI module init hook,
 * after setAiModuleDeps() has wired the db and scheduler.
 *
 * In PGlite mode, uses the custom PGliteStore adapter.
 * In Postgres mode, uses PostgresStore from @mastra/pg.
 */
import type { PGlite } from '@electric-sql/pglite';
import { Mastra } from '@mastra/core';
import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';

import { getMastraAgents } from './agents';
import { escalateToStaffTool } from './tools/escalate';
import { searchKnowledgeBaseTool } from './tools/search-kb';
import { escalationWorkflow } from './workflows/escalation';
import { followUpWorkflow } from './workflows/follow-up';

let mastraInstance: Mastra | undefined;
let memoryInstance: Memory | undefined;

/**
 * Initialize the Mastra singleton with storage from the vobase db connection.
 * Called from the AI module init hook after setAiModuleDeps().
 */
export async function initMastra(db: { $client: unknown }): Promise<void> {
  const dbUrl = process.env.DATABASE_URL || './data/pgdata';
  const isPostgres =
    dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');

  let store: PostgresStore;
  if (isPostgres) {
    store = new PostgresStore({
      id: 'vobase-pg',
      connectionString: dbUrl,
    });
  } else {
    // PGlite mode — extract PGlite instance from Drizzle db.$client
    const { PGliteStore } = await import('./lib/storage/pglite-store');
    const pglite = db.$client as PGlite;
    // PGliteStore extends MastraCompositeStore, same base as PostgresStore
    store = new PGliteStore(pglite) as unknown as PostgresStore;
  }

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
      escalate_to_staff: escalateToStaffTool,
    },
    workflows: {
      'ai:escalation': escalationWorkflow,
      'ai:follow-up': followUpWorkflow,
    },
    memory: { 'agent-memory': memoryInstance },
    storage: store,
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
