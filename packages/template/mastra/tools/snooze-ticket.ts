import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { msgConversations } from '../../modules/messaging/schema';
import { getModuleDb } from '../lib/deps';

/**
 * Snooze the current conversation until a specified time.
 * Sets status to snoozed and records the wake-up time.
 * Reads conversationId from Mastra tool execution context's requestContext.
 */
export const snoozeTicketTool = createTool({
  id: 'snooze_ticket',
  description:
    'Snooze the current conversation until a specific date/time. Use when the issue is waiting on an external event, a customer response by a deadline, or needs follow-up later.',
  inputSchema: z.object({
    until: z
      .string()
      .describe(
        'ISO 8601 datetime string for when to un-snooze the conversation',
      ),
    reason: z.string().optional().describe('Brief reason for snoozing'),
  }),
  outputSchema: z.object({
    snoozed: z.boolean(),
    until: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const rc = context.requestContext as Record<string, unknown> | undefined;
    const conversationId = rc?.conversationId as string | undefined;

    if (!conversationId) {
      return {
        snoozed: false,
        error: 'Snooze requires active conversation context',
      };
    }

    const db = getModuleDb();

    await db
      .update(msgConversations)
      .set({
        status: 'snoozed',
        handler: 'unassigned',
        snoozedUntil: new Date(input.until),
      })
      .where(eq(msgConversations.id, conversationId));

    return { snoozed: true, until: input.until };
  },
});
