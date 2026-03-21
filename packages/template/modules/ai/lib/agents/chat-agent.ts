import { Agent } from '@mastra/core/agent';
import type { Scheduler, VobaseDb } from '@vobase/core';

import { createModerationProcessor } from '../guardrails/moderation';
import {
  createMemoryInputProcessor,
  createMemoryOutputProcessor,
} from '../memory/memory-processor';
import type { AgentConfig } from './define';
import {
  buildBaseConfig,
  DEFAULT_INSTRUCTIONS,
  resolveScope,
  type ThreadContext,
  toMastraModelId,
} from './shared';

interface CreateAgentOptions {
  db: VobaseDb;
  scheduler: Scheduler;
  agent: AgentConfig;
  thread: ThreadContext;
}

/**
 * Create a Mastra Agent configured for web chat streaming.
 * Tools: knowledge base search (configurable via agent.tools).
 * Guardrails: content moderation always applied.
 * Memory: input/output processors when scope is available.
 */
export function createChatAgent(options: CreateAgentOptions) {
  const { db, scheduler, agent, thread } = options;
  const { modelId, tools } = buildBaseConfig(db, agent);
  const scope = resolveScope(thread);

  return new Agent({
    id: `chat-${agent.id}`,
    name: agent.name,
    instructions: agent.instructions ?? DEFAULT_INSTRUCTIONS,
    model: toMastraModelId(modelId),
    tools,
    defaultOptions: { maxSteps: 5 },
    inputProcessors: [
      createModerationProcessor(),
      ...(scope
        ? [createMemoryInputProcessor({ db, threadId: thread.threadId, scope })]
        : []),
    ],
    outputProcessors: [
      ...(scope
        ? [
            createMemoryOutputProcessor({
              db,
              scheduler,
              threadId: thread.threadId,
              scope,
            }),
          ]
        : []),
    ],
  });
}
