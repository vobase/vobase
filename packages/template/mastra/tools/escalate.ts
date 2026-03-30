import { createTool } from '@mastra/core/tools';
import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { emitActivityEvent } from '../../modules/ai/lib/activity-events';
import { getModuleDeps } from '../../modules/ai/lib/deps';
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
      .describe(
        'Why the escalation is needed (visible to the human operator)',
      ),
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
    const deps = getModuleDeps();
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

    // Prevent no-op or downgrade (agent can't set back to 'ai')
    const currentMode = conversation.mode ?? 'ai';
    if (currentMode === input.mode) {
      return {
        success: true,
        message: `Conversation is already in ${input.mode} mode.`,
      };
    }
    if (currentMode === 'human') {
      return {
        success: false,
        message:
          'Conversation is already in human mode — cannot change from agent side.',
      };
    }

    // Update mode + priority + emit escalation event in same transaction
    await db.transaction(async (tx) => {
      await (tx as unknown as VobaseDb)
        .update(conversations)
        .set({ mode: input.mode, priority: input.priority })
        .where(eq(conversations.id, conversationId));

      // Emit escalation.created for attention queue (pending review)
      await emitActivityEvent(
        db,
        realtime,
        {
          type: 'escalation.created',
          agentId: conversation.agentId,
          source: 'agent',
          contactId: conversation.contactId,
          conversationId,
          channelRoutingId: conversation.channelRoutingId,
          data: {
            reason: input.reason,
            mode: input.mode,
            priority: input.priority,
            previousMode: currentMode,
          },
          resolutionStatus: 'pending',
        },
        tx as unknown as VobaseDb,
      );
    });

    // Emit handler.changed event (fire-and-forget, for activity feed)
    // Keep event type as 'handler.changed' for backwards compat with existing data
    await emitActivityEvent(db, realtime, {
      type: 'handler.changed',
      agentId: conversation.agentId,
      source: 'agent',
      conversationId,
      contactId: conversation.contactId,
      data: {
        from: currentMode,
        to: input.mode,
        reason: input.reason,
      },
    });

    const modeLabel =
      input.mode === 'supervised'
        ? 'Switched to supervised mode — your responses will be reviewed by a human before sending.'
        : 'Conversation transferred to a human agent.';

    return { success: true, message: modeLabel };
  },
});
