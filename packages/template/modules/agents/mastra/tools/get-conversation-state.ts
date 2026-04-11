import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { ModuleDeps } from '../../../messaging/lib/deps';
import { channelInstances, conversations } from '../../../messaging/schema';

export const getConversationStateTool = createTool({
  id: 'get_conversation_state',
  description: 'Get the current state and metadata of a conversation',
  inputSchema: z.object({
    conversationId: z.string().describe('The conversation ID to inspect'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string().optional(),
    id: z.string().optional(),
    status: z.string().optional(),
    assignee: z.string().optional(),
    onHold: z.boolean().optional(),
    holdReason: z.string().nullable().optional(),
    priority: z.string().nullable().optional(),
    channelType: z.string().optional(),
    createdAt: z.string().optional(),
    resolvedAt: z.string().nullable().optional(),
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

    const [row] = await deps.db
      .select({
        id: conversations.id,
        contactId: conversations.contactId,
        status: conversations.status,
        assignee: conversations.assignee,
        onHold: conversations.onHold,
        holdReason: conversations.holdReason,
        priority: conversations.priority,
        createdAt: conversations.createdAt,
        resolvedAt: conversations.resolvedAt,
        channelType: channelInstances.type,
      })
      .from(conversations)
      .leftJoin(
        channelInstances,
        eq(conversations.channelInstanceId, channelInstances.id),
      )
      .where(eq(conversations.id, input.conversationId));

    if (!row) {
      return { success: false, message: 'Conversation not found' };
    }

    if (row.contactId !== contactId) {
      return {
        success: false,
        message: 'Access denied: conversation belongs to different contact',
      };
    }

    return {
      success: true,
      id: row.id,
      status: row.status,
      assignee: row.assignee,
      onHold: row.onHold,
      holdReason: row.holdReason,
      priority: row.priority,
      channelType: row.channelType ?? undefined,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  },
});
