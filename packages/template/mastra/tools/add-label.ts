import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  msgConversationLabels,
  msgLabels,
} from '../../modules/messaging/schema';
import { getModuleDb } from '../lib/deps';

/**
 * Add a label to the current conversation.
 * Creates the label if it doesn't exist yet, and handles duplicates gracefully.
 * Reads conversationId from Mastra tool execution context's requestContext.
 */
export const addLabelTool = createTool({
  id: 'add_label',
  description:
    'Add a label/tag to the current conversation for categorization. Creates the label if it does not exist. Use to classify issues (e.g. "billing", "bug", "feature-request").',
  inputSchema: z.object({
    label: z.string().describe('Label name to add to the conversation'),
  }),
  outputSchema: z.object({
    added: z.boolean(),
    label: z.string(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const rc = context.requestContext as Record<string, unknown> | undefined;
    const conversationId = rc?.conversationId as string | undefined;

    if (!conversationId) {
      return {
        added: false,
        label: input.label,
        error: 'Label addition requires active conversation context',
      };
    }

    const db = getModuleDb();

    // Find or create the label
    let [label] = await db
      .select()
      .from(msgLabels)
      .where(eq(msgLabels.name, input.label))
      .limit(1);

    if (!label) {
      [label] = await db
        .insert(msgLabels)
        .values({ name: input.label })
        .returning();
    }

    // Insert conversation-label link, ignore if already exists
    try {
      await db
        .insert(msgConversationLabels)
        .values({ conversationId, labelId: label.id });
    } catch (err: unknown) {
      // Duplicate key (label already on conversation) — treat as success
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('duplicate') && !message.includes('unique')) {
        throw err;
      }
    }

    return { added: true, label: input.label };
  },
});
