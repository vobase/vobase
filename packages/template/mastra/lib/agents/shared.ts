import type { MemoryScope } from '../../processors/memory/types';

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
