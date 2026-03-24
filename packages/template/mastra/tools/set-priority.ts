import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { msgConversations } from '../../modules/messaging/schema';
import { getModuleDb } from '../lib/deps';

/**
 * Set or update the priority of the current conversation.
 * Reads conversationId from Mastra tool execution context's requestContext.
 */
export const setPriorityTool = createTool({
  id: 'set_priority',
  description:
    'Set or update the priority level of the current conversation. Use when the urgency of the issue changes or needs to be classified.',
  inputSchema: z.object({
    priority: z
      .enum(['low', 'medium', 'high', 'urgent'])
      .describe('The priority level to set'),
    reason: z
      .string()
      .optional()
      .describe('Brief reason for the priority change'),
  }),
  outputSchema: z.object({
    updated: z.boolean(),
    priority: z.string(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const rc = context.requestContext as Record<string, unknown> | undefined;
    const conversationId = rc?.conversationId as string | undefined;

    if (!conversationId) {
      return {
        updated: false,
        priority: input.priority,
        error: 'Priority update requires active conversation context',
      };
    }

    const db = getModuleDb();

    await db
      .update(msgConversations)
      .set({ priority: input.priority })
      .where(eq(msgConversations.id, conversationId));

    return { updated: true, priority: input.priority };
  },
});
