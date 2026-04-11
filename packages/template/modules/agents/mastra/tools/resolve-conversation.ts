import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import type { ModuleDeps } from '../../../messaging/lib/deps';
import { transition } from '../../../messaging/lib/state-machine';

export const resolveConversationTool = createTool({
  id: 'resolve_conversation',
  description:
    'Mark the current conversation as resolved. The conversation will be completed after the current response is delivered.',
  inputSchema: z.object({
    summary: z.string().optional().describe('Brief summary of the resolution'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (_input, context) => {
    const deps = context?.requestContext?.get('deps') as ModuleDeps | undefined;
    if (!deps) return { success: false, message: 'No deps context available' };

    const conversationId =
      (context?.requestContext?.get('conversationId') as string | undefined) ??
      '';

    if (!conversationId) {
      return { success: false, message: 'No conversation context available' };
    }

    const result = await transition(deps, conversationId, {
      type: 'SET_RESOLVING',
    });

    if (!result.ok) {
      return { success: false, message: result.error };
    }

    return {
      success: true,
      message: 'Conversation will be completed after this response.',
    };
  },
});
