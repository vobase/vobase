import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import type { ModuleDeps } from '../../../messaging/lib/deps';
import { transition } from '../../../messaging/lib/state-machine';

export const holdTool = createTool({
  id: 'hold',
  description:
    'Put this conversation on hold. Use when waiting for external information or a callback before proceeding.',
  inputSchema: z.object({
    reason: z.string().describe('Why this conversation is being put on hold'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input, context) => {
    const deps = context?.requestContext?.get('deps') as ModuleDeps | undefined;
    if (!deps) return { success: false, message: 'No deps context available' };

    const conversationId =
      (context?.requestContext?.get('conversationId') as string | undefined) ??
      '';

    if (!conversationId) {
      return { success: false, message: 'No conversation context available' };
    }

    const result = await transition(deps, conversationId, {
      type: 'HOLD',
      reason: input.reason,
    });

    if (!result.ok) {
      return { success: false, message: result.error };
    }

    return { success: true, message: 'Conversation placed on hold.' };
  },
});
