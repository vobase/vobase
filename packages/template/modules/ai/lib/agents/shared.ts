import type { MemoryScope } from '../memory/types';

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
  return null;
}
