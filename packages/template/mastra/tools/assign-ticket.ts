import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { msgConversations } from '../../modules/messaging/schema';
import { getModuleDb } from '../lib/deps';

/**
 * Assign the current conversation to a team and/or staff member.
 * Reads conversationId from Mastra tool execution context's requestContext.
 */
export const assignTicketTool = createTool({
  id: 'assign_ticket',
  description:
    'Assign the current conversation to a specific team and/or staff member. Use when the issue needs to be routed to a particular person or department.',
  inputSchema: z.object({
    teamId: z
      .string()
      .optional()
      .describe('Team ID to route the conversation to'),
    assigneeId: z
      .string()
      .optional()
      .describe('Staff member user ID to assign the conversation to'),
    note: z
      .string()
      .optional()
      .describe('Internal note about the assignment reason'),
  }),
  outputSchema: z.object({
    assigned: z.boolean(),
    teamId: z.string().optional(),
    assigneeId: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const rc = context.requestContext as Record<string, unknown> | undefined;
    const conversationId = rc?.conversationId as string | undefined;

    if (!conversationId) {
      return {
        assigned: false,
        error: 'Assignment requires active conversation context',
      };
    }

    if (!input.teamId && !input.assigneeId) {
      return {
        assigned: false,
        error: 'At least one of teamId or assigneeId must be provided',
      };
    }

    const db = getModuleDb();

    const updates: Record<string, unknown> = {};
    if (input.teamId) updates.teamId = input.teamId;
    if (input.assigneeId) updates.assigneeId = input.assigneeId;

    await db
      .update(msgConversations)
      .set(updates)
      .where(eq(msgConversations.id, conversationId));

    return {
      assigned: true,
      teamId: input.teamId,
      assigneeId: input.assigneeId,
    };
  },
});
