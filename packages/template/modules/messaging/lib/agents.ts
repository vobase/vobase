import { Agent } from '@mastra/core/agent';
import type { Scheduler, VobaseDb } from '@vobase/core';

import { getAIConfig } from '../../../lib/ai';
import type { msgAgents } from '../schema';
import { createEscalationTool } from './escalation';
import {
  createMemoryInputProcessor,
  createMemoryOutputProcessor,
} from './memory/memory-processor';
import type { MemoryScope } from './memory/types';
import { createKnowledgeBaseTool } from './tools';

/**
 * Convert a model ID (e.g. 'gpt-5-mini', 'claude-3-5-sonnet') to Mastra's
 * 'provider/model' format (e.g. 'openai/gpt-5-mini', 'anthropic/claude-3-5-sonnet').
 */
export function toMastraModelId(modelId: string): string {
  if (modelId.includes('/')) return modelId;
  if (modelId.startsWith('claude-')) return `anthropic/${modelId}`;
  if (modelId.startsWith('gemini-')) return `google/${modelId}`;
  if (
    !modelId.startsWith('gpt-') &&
    !modelId.startsWith('o1') &&
    !modelId.startsWith('o3') &&
    !modelId.startsWith('o4')
  ) {
    console.warn(
      `[agents] Unknown model prefix for "${modelId}", defaulting to openai provider`,
    );
  }
  return `openai/${modelId}`;
}

const DEFAULT_INSTRUCTIONS =
  'You are a helpful assistant. When answering questions, search the knowledge base for relevant information and cite your sources.';

type AgentRow = typeof msgAgents.$inferSelect;

/** Parse a JSON text column safely, returning the fallback on invalid/missing data. */
function parseJsonArray(value: string | null, fallback: string[]): string[] {
  if (!value) return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return parsed;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/** Shared agent config: resolve model, parse tools/kbSourceIds, build KB tool. */
function buildBaseConfig(db: VobaseDb, agent: AgentRow) {
  const config = getAIConfig();
  const modelId = agent.model ?? config.model;
  const enabledTools = parseJsonArray(agent.tools, ['search_knowledge_base']);
  const kbSourceIds = agent.kbSourceIds
    ? parseJsonArray(agent.kbSourceIds, [])
    : undefined;

  const tools: Record<
    string,
    ReturnType<typeof createKnowledgeBaseTool | typeof createEscalationTool>
  > = {};

  if (enabledTools.includes('search_knowledge_base')) {
    tools.search_knowledge_base = createKnowledgeBaseTool(
      db,
      kbSourceIds?.length ? kbSourceIds : undefined,
    );
  }

  return { modelId, tools, enabledTools };
}

interface ThreadContext {
  threadId: string;
  contactId?: string | null;
  userId?: string | null;
}

interface CreateAgentOptions {
  db: VobaseDb;
  scheduler: Scheduler;
  agent: AgentRow;
  thread: ThreadContext;
}

/** Resolve memory scope from thread context. Returns null if no valid scope. */
function resolveScope(thread: ThreadContext): MemoryScope | null {
  if (thread.contactId) {
    return { contactId: thread.contactId, userId: thread.userId ?? undefined };
  }
  if (thread.userId) {
    return { userId: thread.userId };
  }
  // No valid scope — memory processors will be skipped
  return null;
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
