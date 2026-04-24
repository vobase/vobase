/**
 * Mastra singleton — central registry for agents, tools, workflows, and memory.
 *
 * Initialized lazily via initMastra() called from the AI module init hook,
 * after setAiModuleDeps() has wired the db and scheduler.
 */
import { Mastra } from '@mastra/core'
import { MastraCompositeStore } from '@mastra/core/storage'
import { Memory } from '@mastra/memory'
import { PgVector, PostgresStore } from '@mastra/pg'
import type { VobaseDb } from '@vobase/core'

import { buildCustomScorer } from './evals/custom-scorer-factory'
import { scorers } from './evals/scorers'
import { models } from './lib/models'
import { agentModel, getEmbeddingModel } from './lib/provider'
import { VobaseMemoryStorage } from './storage/vobase-memory'

let mastraInstance: Mastra | undefined
let memoryInstance: Memory | undefined

/**
 * Initialize the Mastra singleton with storage from the vobase db connection.
 * Called from the AI module init hook after setAiModuleDeps().
 *
 * Memory domain routes to VobaseMemoryStorage (conversations schema),
 * everything else (workflows, observability) uses PostgresStore.
 */
export async function initMastra(db: { $client: unknown }): Promise<void> {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) throw new Error('DATABASE_URL is required')

  const pgStore = new PostgresStore({
    id: 'vobase-pg',
    connectionString: dbUrl,
    schemaName: 'mastra',
  })

  await pgStore.init()

  // OM methods delegate to PostgresStore's MemoryPG — must exist after init()
  const omDelegate = pgStore.stores.memory
  if (!omDelegate) throw new Error('PostgresStore did not initialize memory domain')

  const vobaseMemory = new VobaseMemoryStorage(db as VobaseDb, omDelegate)

  const compositeStore = new MastraCompositeStore({
    id: 'vobase-composite',
    default: pgStore,
    domains: {
      memory: vobaseMemory,
    },
  })

  const pgVector = new PgVector({
    connectionString: dbUrl,
    id: 'vobase-vectors',
  })

  memoryInstance = new Memory({
    storage: compositeStore,
    vector: pgVector,
    embedder: getEmbeddingModel(models.gpt_embedding),
    options: {
      lastMessages: false, // Agent reads conversation/messages.md instead
      semanticRecall: false, // Agent uses vobase recall on demand
      workingMemory: { enabled: false }, // Replaced by contact/notes.md
      observationalMemory: {
        enabled: true, // Essential: compresses agent reasoning thread
        model: agentModel(models.gpt_mini),
        scope: 'resource',
      },
    },
  })

  mastraInstance = new Mastra({
    agents: {},
    tools: {},
    workflows: {},
    memory: { 'agent-memory': memoryInstance },
    storage: compositeStore,
    scorers: Object.fromEntries(scorers.map((s) => [s.id, s])),
  })

  // Load published custom scorer definitions from Mastra storage and register
  // them on the instance so they participate in live scoring alongside code scorers.
  try {
    const scorerDefsStore = await compositeStore.getStore('scorerDefinitions')
    if (scorerDefsStore) {
      const result = (await scorerDefsStore.listResolved()) as Record<string, unknown>
      const rawDefs = Array.isArray(result?.scorerDefinitions)
        ? (result.scorerDefinitions as Record<string, unknown>[])
        : []
      const defs = rawDefs.filter((d) => d.status === 'published')
      for (const def of defs) {
        const metadata = (def.metadata ?? {}) as Record<string, unknown>
        const scorer = buildCustomScorer({
          id: def.id as string,
          name: (def.name as string) ?? '',
          description: (def.description as string) ?? '',
          criteria: (def.instructions as string) ?? '',
          model: (metadata.model as string) ?? 'gpt-5.4',
        })
        mastraInstance.addScorer(scorer)
      }
    }
  } catch {
    // Scorer definitions table may not exist on first boot — safe to skip
  }
}

/** Get the Mastra singleton. Throws if not initialized. */
export function getMastra(): Mastra {
  if (!mastraInstance) throw new Error('Mastra not initialized — call initMastra() first')
  return mastraInstance
}

/** Get the Memory instance. Throws if not initialized. */
export function getMemory(): Memory {
  if (!memoryInstance) throw new Error('Memory not initialized — call initMastra() first')
  return memoryInstance
}
