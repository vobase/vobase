import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { conversations } from '../../modules/conversations/schema';

export const completeConversationTool = createTool({
  id: 'complete_conversation',
  description:
    'Mark the current conversation as resolved. The conversation will be completed after the current response is delivered.',
  inputSchema: z.object({
    summary: z.string().optional().describe('Brief summary of the resolution'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input, context) => {
    const { getConversationsDeps } = await import(
      '../../modules/conversations/lib/deps'
    );
    const deps = getConversationsDeps();

    const conversationId =
      (context?.requestContext?.get('conversationId') as string | undefined) ??
      '';

    if (!conversationId) {
      return { success: false, message: 'No conversation context available' };
    }

    const [conversation] = await deps.db
      .select({
        metadata: conversations.metadata,
        status: conversations.status,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (!conversation || conversation.status !== 'active') {
      return {
        success: false,
        message: 'Conversation not found or not active',
      };
    }

    const existingMeta =
      conversation.metadata && typeof conversation.metadata === 'object'
        ? (conversation.metadata as Record<string, unknown>)
        : {};

    await deps.db
      .update(conversations)
      .set({
        metadata: {
          ...existingMeta,
          completing: true,
          completionSummary: input.summary,
        },
      })
      .where(eq(conversations.id, conversationId));

    return {
      success: true,
      message: 'Conversation will be completed after this response.',
    };
  },
});
