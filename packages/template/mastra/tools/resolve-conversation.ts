import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { msgConversations } from '../../modules/messaging/schema';
import { getModuleDb } from '../lib/deps';

/**
 * Resolve the current conversation, marking it as completed.
 * Reads conversationId from Mastra tool execution context's requestContext.
 */
export const resolveConversationTool = createTool({
  id: 'resolve_conversation',
  description:
    'Mark the current conversation as resolved. Use when the customer issue has been fully addressed and no further action is needed.',
  inputSchema: z.object({
    summary: z.string().describe('Brief summary of how the issue was resolved'),
  }),
  outputSchema: z.object({
    resolved: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const rc = context.requestContext as Record<string, unknown> | undefined;
    const conversationId = rc?.conversationId as string | undefined;

    if (!conversationId) {
      return {
        resolved: false,
        error: 'Resolution requires active conversation context',
      };
    }

    const db = getModuleDb();

    await db
      .update(msgConversations)
      .set({
        status: 'resolved',
        handler: 'unassigned',
        resolvedAt: new Date(),
      })
      .where(eq(msgConversations.id, conversationId));

    return { resolved: true };
  },
});
