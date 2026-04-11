import { createTool } from '@mastra/core/tools';
import { and, asc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';

import type { ModuleDeps } from '../../../messaging/lib/deps';
import { conversations, messages } from '../../../messaging/schema';

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

    // Verify conversation belongs to this contact
    const [conversation] = await deps.db
      .select({ id: conversations.id, contactId: conversations.contactId })
      .from(conversations)
      .where(eq(conversations.id, input.conversationId));

    if (!conversation) {
      return { success: false, message: 'Conversation not found' };
    }

    if (conversation.contactId !== contactId) {
      return {
        success: false,
        message: 'Access denied: conversation belongs to different contact',
      };
    }

    const conditions = [eq(messages.conversationId, input.conversationId)];
    if (input.since) {
      conditions.push(gte(messages.createdAt, new Date(input.since)));
    }

    const rows = await deps.db
      .select({
        id: messages.id,
        senderId: messages.senderId,
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
      messages: rows.map((m) => ({
        id: m.id,
        from: m.senderId,
        content: m.content,
        contentType: m.contentType,
        time: m.createdAt.toISOString(),
      })),
    };
  },
});
