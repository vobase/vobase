import type { MemoryScope } from '../../processors/memory/types';

export interface ConversationContext {
  conversationId: string;
  contactId?: string | null;
  userId?: string | null;
}

/** Resolve memory scope from conversation context. Returns null if no valid scope. */
export function resolveScope(
  conversation: ConversationContext,
): MemoryScope | null {
  if (conversation.contactId) {
    return {
      contactId: conversation.contactId,
      userId: conversation.userId ?? undefined,
    };
  }
  if (conversation.userId) {
    return { userId: conversation.userId };
  }
  return null;
}
