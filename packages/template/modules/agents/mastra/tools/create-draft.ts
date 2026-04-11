import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { ModuleDeps } from '../../../messaging/lib/deps';
import { insertMessage } from '../../../messaging/lib/messages';
import { conversations } from '../../../messaging/schema';
import { resolveTarget } from './_resolve-target';

export const createDraftTool = createTool({
  id: 'create_draft',
  description:
    'Create a draft response for human review. Use when you have a proposed reply but want a staff member to approve it before sending.',
  inputSchema: z.object({
    content: z.string().describe('The draft response content'),
    reason: z.string().describe('Why human review is needed'),
    reviewer: z.object({
      type: z
        .enum(['role', 'user'])
        .describe(
          '"role" to resolve by role name, "user" to use a userId directly',
        ),
      value: z.string().describe('Role name or userId of the reviewer'),
    }),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input, context) => {
    const deps = context?.requestContext?.get('deps') as ModuleDeps | undefined;
    if (!deps) return { success: false, message: 'No deps context available' };
    const { db, realtime } = deps;

    const conversationId =
      (context?.requestContext?.get('conversationId') as string | undefined) ??
      '';
    const agentId =
      (context?.requestContext?.get('agentId') as string | undefined) ??
      'agent';

    if (!conversationId) {
      return { success: false, message: 'No conversation context available' };
    }

    const reviewerId = await resolveTarget(db, input.reviewer);
    if (!reviewerId) {
      return {
        success: false,
        message: `Could not resolve reviewer: ${input.reviewer.type}=${input.reviewer.value}`,
      };
    }

    const [conversation] = await db
      .select({ agentId: conversations.agentId })
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    const senderId = conversation?.agentId ?? agentId;

    await insertMessage(db, realtime, {
      conversationId,
      messageType: 'activity',
      contentType: 'system',
      content: `agent.draft_created`,
      contentData: {
        eventType: 'agent.draft_created',
        draftContent: input.content,
        reason: input.reason,
        reviewerId,
      },
      senderId,
      senderType: 'agent',
      private: true,
      mentions: [{ targetId: reviewerId, targetType: 'user' }],
    });

    return {
      success: true,
      message: `Draft created and ${reviewerId} notified for review.`,
    };
  },
});
