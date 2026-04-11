import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import type { ModuleDeps } from '../../modules/ai/lib/deps';
import { getModuleDeps } from '../../modules/ai/lib/deps';
import { createActivityMessage } from '../../modules/ai/lib/messages';

export const topicMarkerTool = createTool({
  id: 'topic_marker',
  description: 'Insert a topic-change marker into the conversation timeline',
  inputSchema: z.object({
    summary: z.string().describe('Summary of the previous topic'),
    nextTopic: z.string().optional().describe('Label for the upcoming topic'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input, context) => {
    const deps =
      (context?.requestContext?.get('deps') as ModuleDeps | undefined) ??
      getModuleDeps();

    const conversationId =
      (context?.requestContext?.get('conversationId') as string | undefined) ??
      '';

    if (!conversationId) {
      return { success: false, message: 'No conversation context available' };
    }

    await createActivityMessage(deps.db, deps.realtime, {
      conversationId,
      eventType: 'topic.changed',
      data: {
        summary: input.summary,
        ...(input.nextTopic ? { nextTopic: input.nextTopic } : {}),
      },
    });

    return {
      success: true,
      message: 'Topic-change marker inserted into the conversation timeline.',
    };
  },
});
