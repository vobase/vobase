import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { queueOutboundMessage } from '../../modules/messaging/lib/outbox';
import { msgConversations } from '../../modules/messaging/schema';
import { getModuleDb, getModuleScheduler } from '../lib/deps';

/**
 * Escalate a conversation to a human staff member with structured context.
 * Sets escalation metadata (reason, summary, priority) and switches handler to human.
 * Reads conversationId/channel from Mastra tool execution context's requestContext.
 */
export const escalateTicketTool = createTool({
  id: 'escalate_ticket',
  description:
    'Escalate the conversation to a human staff member with a structured reason and summary. Use when the customer issue requires human judgment, you cannot resolve it, or the customer explicitly asks for a human.',
  inputSchema: z.object({
    reason: z.string().describe('Brief reason for escalation'),
    summary: z
      .string()
      .describe(
        'Summary of the conversation and issue so far for the human agent',
      ),
    priority: z
      .enum(['low', 'medium', 'high', 'urgent'])
      .optional()
      .describe('Override ticket priority if the issue warrants it'),
    teamId: z.string().optional().describe('Route to a specific team by ID'),
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
    const conversationId = rc?.conversationId as string | undefined;
    const channel = rc?.channel as string | undefined;

    if (!conversationId) {
      return {
        escalated: false,
        reason: input.reason,
        error: 'Escalation requires active conversation context',
      };
    }

    const db = getModuleDb();
    const scheduler = getModuleScheduler();

    const updates: Record<string, unknown> = {
      status: 'pending',
      handler: 'human',
      escalationReason: input.reason,
      escalationSummary: input.summary,
      escalationAt: new Date(),
    };
    if (input.priority) updates.priority = input.priority;
    if (input.teamId) updates.teamId = input.teamId;

    await db
      .update(msgConversations)
      .set(updates)
      .where(eq(msgConversations.id, conversationId));

    // Send handoff message to customer
    const handoffMsg =
      input.message ||
      "I'm connecting you with a team member who can help further.";
    await queueOutboundMessage(
      db,
      scheduler,
      conversationId,
      handoffMsg,
      channel ?? 'web',
    );

    return { escalated: true, reason: input.reason };
  },
});
