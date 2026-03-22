import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { queueOutboundMessage } from '../../../messaging/lib/outbox';
import { msgThreads } from '../../../messaging/schema';
import { getModuleDb, getModuleScheduler } from '../deps';

/**
 * Escalate conversation to a human staff member.
 * Static instance — reads threadId/channel from Mastra tool execution context's
 * requestContext (set by the chat handler before calling agent.stream()).
 * In Studio context (no requestContext), returns a clear error message.
 */
export const escalateToStaffTool = createTool({
  id: 'escalate_to_staff',
  description:
    'Hand off the conversation to a human staff member. Use when you cannot help the customer or they explicitly ask for a human.',
  inputSchema: z.object({
    reason: z.string().describe('Brief reason for escalation'),
    message: z
      .string()
      .optional()
      .describe('Optional message to send to the customer before handoff'),
  }),
  outputSchema: z.object({
    escalated: z.boolean(),
    reason: z.string(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const rc = context.requestContext as Record<string, unknown> | undefined;
    const threadId = rc?.threadId as string | undefined;
    const channel = rc?.channel as string | undefined;

    if (!threadId) {
      return {
        escalated: false,
        reason: input.reason,
        error: 'Escalation requires active thread context',
      };
    }

    const db = getModuleDb();
    const scheduler = getModuleScheduler();

    // Update thread status to 'human'
    await db
      .update(msgThreads)
      .set({ status: 'human' })
      .where(eq(msgThreads.id, threadId));

    // Send handoff message to customer
    const handoffMsg =
      input.message ||
      "I'm connecting you with a team member who can help further.";
    await queueOutboundMessage(
      db,
      scheduler,
      threadId,
      handoffMsg,
      channel ?? 'web',
    );

    return { escalated: true, reason: input.reason };
  },
});
