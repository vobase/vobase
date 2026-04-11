import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import type { ModuleDeps } from '../../../messaging/lib/deps';

/**
 * schedule_follow_up — Schedule a delayed agent wake for follow-up.
 * Allows the agent to check back with a contact after a specified delay.
 */
export const scheduleFollowUpTool = createTool({
  id: 'schedule_follow_up',
  description:
    'Schedule a follow-up check-in with the contact after a delay. Use when you want to proactively reach out later (e.g., after a booking, to confirm satisfaction, or to remind about an upcoming appointment).',
  inputSchema: z.object({
    conversationId: z.string().describe('The conversation to follow up on'),
    delaySeconds: z
      .number()
      .int()
      .min(60)
      .max(86400 * 7)
      .describe('Delay in seconds before the follow-up (min 60, max 7 days)'),
    reason: z.string().describe('Why the follow-up is being scheduled'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input, context) => {
    const deps = context?.requestContext?.get('deps') as ModuleDeps | undefined;
    if (!deps) return { success: false, message: 'No deps context available' };

    const agentId =
      (context?.requestContext?.get('agentId') as string | undefined) ??
      'agent';
    const contactId = context?.requestContext?.get('contactId') as
      | string
      | undefined;

    if (!contactId) {
      return { success: false, message: 'No contact context available' };
    }

    await deps.scheduler.add(
      'agents:agent-wake',
      {
        agentId,
        contactId,
        conversationId: input.conversationId,
        trigger: 'scheduled_followup' as const,
        payload: { reason: input.reason },
      },
      { startAfter: input.delaySeconds },
    );

    return {
      success: true,
      message: `Follow-up scheduled in ${input.delaySeconds} seconds: ${input.reason}`,
    };
  },
});
