import type { MemoryScope } from '../../processors/memory/types';

export interface ConversationContext {
  conversationId: string;
  contactId?: string | null;
}

/** Resolve memory scope from conversation context. Returns null if no contactId. */
export function resolveScope(
  conversation: ConversationContext,
): MemoryScope | null {
  if (conversation.contactId) {
    return { contactId: conversation.contactId };
  }
  return null;
}
