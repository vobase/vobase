import type { VobaseDb } from '@vobase/core';

import { getAIConfig } from '../../../../lib/ai';
import type { MemoryScope } from '../memory/types';
import type { createEscalationTool } from '../tools/escalate';
import { createKnowledgeBaseTool } from '../tools/search-kb';
import type { AgentConfig } from './define';

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

export const DEFAULT_INSTRUCTIONS =
  'You are a helpful assistant. When answering questions, search the knowledge base for relevant information and cite your sources.';

/** Shared agent config: resolve model, build tool map from code-based AgentConfig. */
export function buildBaseConfig(db: VobaseDb, agent: AgentConfig) {
  const config = getAIConfig();
  const modelId = agent.model ?? config.model;
  const enabledTools = agent.tools ?? ['search_knowledge_base'];
  const kbSourceIds = agent.kbSourceIds;

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

export interface ThreadContext {
  threadId: string;
  contactId?: string | null;
  userId?: string | null;
}

/** Resolve memory scope from thread context. Returns null if no valid scope. */
export function resolveScope(thread: ThreadContext): MemoryScope | null {
  if (thread.contactId) {
    return { contactId: thread.contactId, userId: thread.userId ?? undefined };
  }
  if (thread.userId) {
    return { userId: thread.userId };
  }
  // No valid scope — memory processors will be skipped
  return null;
}
