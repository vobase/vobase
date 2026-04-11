import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { ModuleDeps } from '../../modules/ai/lib/deps';
import { getModuleDeps } from '../../modules/ai/lib/deps';
import { insertMessage } from '../../modules/ai/lib/messages';
import { conversations } from '../../modules/ai/schema';
import { resolveTarget } from './_resolve-target';

export const mentionTool = createTool({
  id: 'mention',
  description:
    'Send an internal note @mentioning a staff member or role. Use to request guidance or flag something without transferring ownership of the conversation.',
  inputSchema: z.object({
    target: z.object({
      type: z
        .enum(['role', 'user'])
        .describe(
          '"role" to resolve by role name, "user" to use a userId directly',
        ),
      value: z.string().describe('Role name (e.g. "manager") or userId'),
    }),
    message: z
      .string()
      .describe('The note content to send to the mentioned person'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    targetId: z.string().optional(),
  }),
  execute: async (input, context) => {
    const deps =
      (context?.requestContext?.get('deps') as ModuleDeps | undefined) ??
      getModuleDeps();
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

    const targetId = await resolveTarget(db, input.target);
    if (!targetId) {
      return {
        success: false,
        message: `Could not resolve target: ${input.target.type}=${input.target.value}`,
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
      content: `@${targetId}: ${input.message}`,
      contentData: {
        eventType: 'agent.mention',
        note: input.message,
        targetId,
      },
      senderId,
      senderType: 'agent',
      private: true,
      mentions: [{ targetId, targetType: 'user' }],
    });

    return { success: true, message: 'Note sent.', targetId };
  },
});
