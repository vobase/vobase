import { createTool } from '@mastra/core/tools';
import { and, asc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';

import type { ModuleDeps } from '../../../messaging/lib/deps';
import { messages } from '../../../messaging/schema';
import { verifyConversationAccess } from './_verify-conversation';

export const readConversationTool = createTool({
  id: 'read_conversation',
  description: 'Read recent messages from a conversation',
  inputSchema: z.object({
    conversationId: z.string().describe('The conversation ID to read'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe('Maximum number of messages to return'),
    since: z
      .string()
      .optional()
      .describe('ISO date string — only return messages after this time'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string().optional(),
    messages: z
      .array(
        z.object({
          id: z.string(),
          from: z.string(),
          content: z.string(),
          contentType: z.string(),
          time: z.string(),
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

    const check = await verifyConversationAccess(
      deps,
      input.conversationId,
      contactId,
    );
    if (!check.success) return check;

    const conditions = [eq(messages.conversationId, input.conversationId)];
    if (input.since) {
      conditions.push(gte(messages.createdAt, new Date(input.since)));
    }

    const rows = await deps.db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        senderType: messages.senderType,
        content: messages.content,
        contentType: messages.contentType,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(...conditions))
      .orderBy(asc(messages.createdAt))
      .limit(input.limit ?? 20);

    return {
      success: true,
      messages: rows
        .filter((m) => m.contentType !== 'system') // Hide system events from agent
        .map((m) => ({
          id: m.id,
          from:
            m.senderType === 'contact'
              ? 'customer'
              : m.senderType === 'agent'
                ? 'you'
                : m.senderId,
          content: m.content,
          contentType: m.contentType,
          time: m.createdAt.toISOString(),
        })),
    };
  },
});
