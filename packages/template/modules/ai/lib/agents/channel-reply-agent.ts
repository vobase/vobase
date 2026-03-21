import { Agent } from '@mastra/core/agent';
import type { Scheduler, VobaseDb } from '@vobase/core';

import {
  createMemoryInputProcessor,
  createMemoryOutputProcessor,
} from '../memory/memory-processor';
import { createEscalationTool } from '../tools/escalate';
import {
  type AgentRow,
  buildBaseConfig,
  DEFAULT_INSTRUCTIONS,
  resolveScope,
  toMastraModelId,
} from './shared';

interface CreateChannelReplyAgentOptions {
  db: VobaseDb;
  scheduler: Scheduler;
  agent: AgentRow;
  thread: {
    id: string;
    channel: string;
    contactId?: string | null;
    userId?: string | null;
  };
}

/**
 * Create a Mastra Agent configured for external channel replies (WhatsApp, email).
 * Tools: knowledge base search + escalation to human staff.
 * Memory: always-on input/output processors for memory retrieval and formation.
 */
export function createChannelReplyAgent(
  options: CreateChannelReplyAgentOptions,
) {
  const { db, scheduler, agent, thread } = options;
  const { modelId, tools } = buildBaseConfig(db, agent);
  const scope = resolveScope({
    threadId: thread.id,
    contactId: thread.contactId,
    userId: thread.userId,
  });

  // Always include escalation tool for external channels
  tools.escalate_to_staff = createEscalationTool(
    db,
    scheduler,
    thread.id,
    thread.channel,
  );

  return new Agent({
    id: `channel-${agent.id}`,
    name: agent.name,
    instructions: agent.systemPrompt ?? DEFAULT_INSTRUCTIONS,
    model: toMastraModelId(modelId),
    tools,
    defaultOptions: { maxSteps: 5 },
    ...(scope && {
      inputProcessors: [
        createMemoryInputProcessor({ db, threadId: thread.id, scope }),
      ],
      outputProcessors: [
        createMemoryOutputProcessor({
          db,
          scheduler,
          threadId: thread.id,
          scope,
        }),
      ],
    }),
  });
}
