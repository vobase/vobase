import { createTool } from '@mastra/core/tools';
import { and, asc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';

import type { ModuleDeps } from '../../../messaging/lib/deps';
import { messages } from '../../../messaging/schema';
import { verifyConversationAccess } from './_verify-conversation';

/** Format non-text message content, preferring captions when available. */
function formatContentForAgent(
  content: string,
  contentType: string,
  caption: string | null,
): string {
  switch (contentType) {
    case 'image':
      return caption
        ? `[Image] ${caption}`
        : '(customer sent an image — already visible in your context above)';
    case 'video':
      return (
        caption ||
        '(customer sent a video — not viewable, ask about the content if relevant)'
      );
    case 'audio':
      return (
        caption ||
        '(customer sent a voice message — not playable, ask them to summarize if relevant)'
      );
    case 'sticker':
      return '(customer sent a sticker)';
    case 'document':
      return caption
        ? `[Document] ${caption}`
        : '(customer sent a document — not readable, ask them to describe what they need)';
    default:
      return content;
  }
}

export const readConversationTool = createTool({
  id: 'read_conversation',
  description:
    'Read messages from a conversation. Recent messages are automatically loaded into your context — use this tool to refresh, load older messages beyond the initial window, or read a different conversation.',
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
        caption: messages.caption,
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
          content: formatContentForAgent(m.content, m.contentType, m.caption),
          contentType: m.contentType,
          time: m.createdAt.toISOString(),
        })),
    };
  },
});
