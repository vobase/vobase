import { createTool } from '@mastra/core/tools';
import type { Scheduler, VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { queueOutboundMessage } from '../../../messaging/lib/outbox';
import { msgThreads } from '../../../messaging/schema';

/**
 * Create the escalate_to_staff tool for AI agents.
 * Sets thread status to 'human' and queues a handoff message.
 */
export function createEscalationTool(
  db: VobaseDb,
  scheduler: Scheduler,
  threadId: string,
  channel: string,
) {
  return createTool({
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
    }),
    execute: async (input) => {
      // 1. Update thread status to 'human'
      await db
        .update(msgThreads)
        .set({ status: 'human' })
        .where(eq(msgThreads.id, threadId));

      // 2. Send handoff message to customer
      const handoffMsg =
        input.message ||
        "I'm connecting you with a team member who can help further.";
      await queueOutboundMessage(db, scheduler, threadId, handoffMsg, channel);

      return { escalated: true, reason: input.reason };
    },
  });
}
