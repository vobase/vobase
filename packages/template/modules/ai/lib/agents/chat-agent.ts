import { Agent } from '@mastra/core/agent';
import type { Scheduler, VobaseDb } from '@vobase/core';

import {
  createMemoryInputProcessor,
  createMemoryOutputProcessor,
} from '../memory/memory-processor';
import {
  type AgentRow,
  buildBaseConfig,
  DEFAULT_INSTRUCTIONS,
  resolveScope,
  type ThreadContext,
  toMastraModelId,
} from './shared';

interface CreateAgentOptions {
  db: VobaseDb;
  scheduler: Scheduler;
  agent: AgentRow;
  thread: ThreadContext;
}

/**
 * Create a Mastra Agent configured for web chat streaming.
 * Tools: knowledge base search (configurable via agent.tools).
 * Memory: always-on input/output processors for memory retrieval and formation.
 */
export function createChatAgent(options: CreateAgentOptions) {
  const { db, scheduler, agent, thread } = options;
  const { modelId, tools } = buildBaseConfig(db, agent);
  const scope = resolveScope(thread);

  return new Agent({
    id: `chat-${agent.id}`,
    name: agent.name,
    instructions: agent.systemPrompt ?? DEFAULT_INSTRUCTIONS,
    model: toMastraModelId(modelId),
    tools,
    defaultOptions: { maxSteps: 5 },
    ...(scope && {
      inputProcessors: [
        createMemoryInputProcessor({ db, threadId: thread.threadId, scope }),
      ],
      outputProcessors: [
        createMemoryOutputProcessor({
          db,
          scheduler,
          threadId: thread.threadId,
          scope,
        }),
      ],
    }),
  });
}
