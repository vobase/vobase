import { eq } from 'drizzle-orm';

import type { ModuleDeps } from '../../../messaging/lib/deps';
import { channelInstances, conversations } from '../../../messaging/schema';

/**
 * Verify a conversation exists and belongs to the given contact.
 * Also resolves the channel type from the conversation's channel instance.
 * Returns the conversation row + channelType on success, or a { success, message } error object.
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

  // Resolve channel type from the conversation's channel instance
  let channelType = 'web';
  if (conversation.channelInstanceId) {
    const [instance] = await deps.db
      .select({ type: channelInstances.type })
      .from(channelInstances)
      .where(eq(channelInstances.id, conversation.channelInstanceId));
    if (instance) channelType = instance.type;
  }

  return { success: true as const, conversation, channelType };
}
