import { eq } from 'drizzle-orm';

import type { ModuleDeps } from '../../../messaging/lib/deps';
import { conversations } from '../../../messaging/schema';

/**
 * Verify a conversation exists and belongs to the given contact.
 * Returns the conversation row on success, or a { success, message } error object.
 */
export async function verifyConversationAccess(
  deps: ModuleDeps,
  conversationId: string,
  contactId: string,
) {
  const [conversation] = await deps.db
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      channelInstanceId: conversations.channelInstanceId,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId));

  if (!conversation) {
    return { success: false as const, message: 'Conversation not found' };
  }

  if (conversation.contactId !== contactId) {
    return {
      success: false as const,
      message: 'Access denied: conversation belongs to different contact',
    };
  }

  return { success: true as const, conversation };
}
