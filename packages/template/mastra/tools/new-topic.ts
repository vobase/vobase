import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { ModuleDeps } from '../../modules/ai/lib/deps';
import { getModuleDeps } from '../../modules/ai/lib/deps';
import { transition } from '../../modules/ai/lib/state-machine';
import { interactions } from '../../modules/ai/schema';

export const newTopicTool = createTool({
  id: 'new_topic',
  description:
    'Signal that the contact is switching to a new topic. Resolves the current interaction and the next message will start a fresh interaction.',
  inputSchema: z.object({
    summary: z.string().describe('Summary of the resolved topic'),
    nextTopic: z.string().optional().describe('Label for the upcoming topic'),
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

    // Resolve the interaction with topic_change outcome
    const result = await transition(deps, interactionId, {
      type: 'RESOLVE',
      outcome: 'topic_change',
    });

    if (!result.ok) {
      return { success: false, message: result.error };
    }

    // Set topicChangePending flag via direct column update
    await deps.db
      .update(interactions)
      .set({ topicChangePending: true })
      .where(eq(interactions.id, interactionId));

    return {
      success: true,
      message: 'Topic resolved. Next message will start a new interaction.',
    };
  },
});
