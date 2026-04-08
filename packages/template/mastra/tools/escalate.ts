import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { ModuleDeps } from '../../modules/ai/lib/deps';
import { getModuleDeps } from '../../modules/ai/lib/deps';
import { createActivityMessage } from '../../modules/ai/lib/messages';
import { transition } from '../../modules/ai/lib/state-machine';
import { conversations } from '../../modules/ai/schema';

const ESCALATION_MODES = ['supervised', 'human'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

/**
 * Graduated escalation tool — lets the agent change how the conversation is handled.
 *
 * Available modes (agent can only escalate UP, never back to 'ai'):
 *   supervised — AI drafts responses, a human reviews and approves before sending.
 *                Use for sensitive topics, complaints, legal questions, or when unsure.
 *   human     — Complete transfer to a human. AI stops responding entirely.
 *                Use ONLY when the customer explicitly refuses AI assistance.
 */
export const escalateTool = createTool({
  id: 'escalate',
  description: `Escalate this conversation to involve a human. Two modes available:
- "supervised": AI drafts responses but a human must approve them before sending. Use for sensitive topics (complaints, billing disputes, legal), uncertain answers, or when the stakes are high. The customer stays engaged while a human reviews.
- "human": Complete transfer to a human agent — AI stops entirely. Use ONLY when the customer explicitly says they want a real person ("talk to a human", "no more bot"). This is irreversible from your side.
For background help without changing the mode, use consult_human instead.`,
  inputSchema: z.object({
    mode: z
      .enum(ESCALATION_MODES)
      .describe(
        'The mode to set: "supervised" (AI drafts, human approves) or "human" (full transfer, AI stops)',
      ),
    reason: z
      .string()
      .describe('Why the escalation is needed (visible to the human operator)'),
    priority: z
      .enum(PRIORITIES)
      .describe(
        'Priority level for human attention: "low", "normal", "high", or "urgent"',
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input, context) => {
    const deps =
      (context?.requestContext?.get('deps') as ModuleDeps | undefined) ??
      getModuleDeps();
    const { db, realtime } = deps;

    const conversationId =
      (context?.requestContext?.get('conversationId') as string | undefined) ??
      '';

    if (!conversationId) {
      return { success: false, message: 'No conversation context available' };
    }

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (!conversation || conversation.status !== 'active') {
      return {
        success: false,
        message: 'Conversation not found or not active',
      };
    }

    // Transition mode + priority atomically via state machine
    const currentMode = conversation.mode ?? 'ai';
    const result = await transition(deps, conversationId, {
      type: 'ESCALATE_MODE',
      mode: input.mode,
      priority: input.priority,
    });

    if (!result.ok) {
      return { success: false, message: result.error };
    }

    // Emit escalation.created for attention queue (pending review)
    await createActivityMessage(db, realtime, {
      conversationId,
      eventType: 'escalation.created',
      actor: conversation.agentId,
      actorType: 'agent',
      data: {
        reason: input.reason,
        mode: input.mode,
        priority: input.priority,
        previousMode: currentMode,
        contactId: conversation.contactId,
        channelRoutingId: conversation.channelRoutingId,
      },
      resolutionStatus: 'pending',
    });

    const modeLabel =
      input.mode === 'supervised'
        ? 'Switched to supervised mode — your responses will be reviewed by a human before sending.'
        : 'Conversation transferred to a human agent.';

    return { success: true, message: modeLabel };
  },
});
