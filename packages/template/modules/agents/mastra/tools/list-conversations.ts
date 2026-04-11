import { createTool } from '@mastra/core/tools';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { ModuleDeps } from '../../../messaging/lib/deps';
import { channelInstances, conversations } from '../../../messaging/schema';

export const listConversationsTool = createTool({
  id: 'list_my_conversations',
  description: 'List conversations for the current contact',
  inputSchema: z.object({
    status: z
      .enum(['active', 'resolving', 'resolved'])
      .optional()
      .describe('Filter by conversation status'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string().optional(),
    conversations: z
      .array(
        z.object({
          id: z.string(),
          status: z.string(),
          channelType: z.string().nullable(),
          createdAt: z.string(),
        }),
      )
      .optional(),
  }),
  execute: async (input, context) => {
    const deps = context?.requestContext?.get('deps') as ModuleDeps | undefined;
    if (!deps) return { success: false, message: 'No deps context available' };

    const contactId = context?.requestContext?.get('contactId') as
      | string
      | undefined;

    if (!contactId) {
      return { success: false, message: 'No contact context available' };
    }

    const conditions = [eq(conversations.contactId, contactId)];
    if (input.status) {
      conditions.push(eq(conversations.status, input.status));
    }

    const rows = await deps.db
      .select({
        id: conversations.id,
        status: conversations.status,
        createdAt: conversations.createdAt,
        channelType: channelInstances.type,
      })
      .from(conversations)
      .leftJoin(
        channelInstances,
        eq(conversations.channelInstanceId, channelInstances.id),
      )
      .where(and(...conditions));

    return {
      success: true,
      conversations: rows.map((r) => ({
        id: r.id,
        status: r.status,
        channelType: r.channelType ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  },
});
