import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import type { ModuleDeps } from '../../modules/ai/lib/deps';
import { getModuleDeps } from '../../modules/ai/lib/deps';
import { transition } from '../../modules/ai/lib/state-machine';

export const resolveInteractionTool = createTool({
  id: 'resolve_interaction',
  description:
    'Mark the current interaction as resolved. The interaction will be completed after the current response is delivered.',
  inputSchema: z.object({
    summary: z.string().optional().describe('Brief summary of the resolution'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (_input, context) => {
    const deps =
      (context?.requestContext?.get('deps') as ModuleDeps | undefined) ??
      getModuleDeps();

    const interactionId =
      (context?.requestContext?.get('interactionId') as string | undefined) ??
      '';

    if (!interactionId) {
      return { success: false, message: 'No interaction context available' };
    }

    const result = await transition(deps, interactionId, {
      type: 'SET_RESOLVING',
    });

    if (!result.ok) {
      return { success: false, message: result.error };
    }

    return {
      success: true,
      message: 'Interaction will be completed after this response.',
    };
  },
});
