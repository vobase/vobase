import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { enqueueDelivery } from '../../../messaging/lib/delivery';
import type { ModuleDeps } from '../../../messaging/lib/deps';
import { insertMessage } from '../../../messaging/lib/messages';
import { verifyConversationAccess } from './_verify-conversation';

export const sendReplyTool = createTool({
  id: 'send_reply',
  description: 'Send a reply message to the customer in a conversation',
  inputSchema: z.object({
    conversationId: z.string().describe('The conversation ID to reply to'),
    content: z.string().describe('The message content to send'),
    contentType: z
      .string()
      .optional()
      .default('text')
      .describe('Content type (default: text)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input, context) => {
    const deps = context?.requestContext?.get('deps') as ModuleDeps | undefined;
    if (!deps) return { success: false, message: 'No deps context available' };

    const contactId = context?.requestContext?.get('contactId') as
      | string
      | undefined;

    const agentId =
      (context?.requestContext?.get('agentId') as string | undefined) ??
      'agent';

    if (!contactId) {
      return { success: false, message: 'No contact context available' };
    }

    const check = await verifyConversationAccess(
      deps,
      input.conversationId,
      contactId,
    );
    if (!check.success) return check;

    const msg = await insertMessage(deps.db, deps.realtime, {
      conversationId: input.conversationId,
      messageType: 'outgoing',
      contentType: (input.contentType ?? 'text') as 'text',
      content: input.content,
      status: 'queued',
      senderId: agentId,
      senderType: 'agent',
    });

    await enqueueDelivery(deps.scheduler, msg.id);

    await deps.realtime
      .notify({
        table: 'conversations',
        id: input.conversationId,
        action: 'new-message',
      })
      .catch(() => {});

    return { success: true, message: 'Reply sent.' };
  },
});
