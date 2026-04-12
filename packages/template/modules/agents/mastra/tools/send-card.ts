/**
 * send_card — Mastra tool for sending structured interactive cards.
 *
 * Accepts a simplified flat schema (LLM-friendly), validates against
 * per-channel constraints, builds a CardElement, and stores it as an
 * outgoing message in the conversation.
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import {
  Actions,
  Button,
  Card,
  CardText,
} from '../../../messaging/lib/card-serialization';
import { getConstraints } from '../../../messaging/lib/channel-constraints';
import { enqueueDelivery } from '../../../messaging/lib/delivery';
import type { ModuleDeps } from '../../../messaging/lib/deps';
import { insertMessage } from '../../../messaging/lib/messages';
import { verifyConversationAccess } from './_verify-conversation';

export const sendCardTool = createTool({
  id: 'send_card',
  description:
    'Send an interactive card with optional buttons to the customer. The card is stored as a message in the conversation. Use when you want to present structured information or interactive choices.',
  inputSchema: z.object({
    conversationId: z
      .string()
      .describe('The conversation ID to send the card to'),
    title: z.string().optional().describe('Optional card title'),
    body: z.string().describe('Message text shown in the card body'),
    buttons: z
      .array(
        z.object({
          id: z.string().describe('Unique action identifier for this button'),
          label: z.string().describe('Button text shown to the user'),
          style: z
            .enum(['primary', 'danger', 'default'])
            .optional()
            .describe('Visual style hint'),
        }),
      )
      .max(10)
      .optional()
      .describe('Interactive reply buttons'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    error: z.string().optional().describe('Validation error — fix and retry'),
  }),
  execute: async (inputData, context) => {
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
      inputData.conversationId,
      contactId,
    );
    if (!check.success) return check;

    const channel =
      (context?.requestContext?.get('channel') as string | undefined) ?? 'web';
    const constraints = getConstraints(channel);
    const { title, body, buttons } = inputData;

    // Validate body length
    if (body.length > constraints.maxBodyLength) {
      return {
        success: false,
        message: 'Validation failed',
        error: `${constraints.name} body must be ${constraints.maxBodyLength} characters or less, got ${body.length}. Shorten the message body.`,
      };
    }

    // Validate button count
    if (
      buttons &&
      constraints.maxButtons !== null &&
      buttons.length > constraints.maxButtons
    ) {
      return {
        success: false,
        message: 'Validation failed',
        error: `${constraints.name} allows max ${constraints.maxButtons} buttons, got ${buttons.length}. Reduce button count.`,
      };
    }

    // Validate individual button label lengths
    if (buttons) {
      for (const btn of buttons) {
        if (btn.label.length > constraints.maxButtonLabelLength) {
          return {
            success: false,
            message: 'Validation failed',
            error: `${constraints.name} button labels must be ${constraints.maxButtonLabelLength} characters or less. Button "${btn.id}" label "${btn.label}" is ${btn.label.length} characters. Shorten it.`,
          };
        }
      }
    }

    const actionButtons = (buttons ?? []).map((btn) =>
      Button({
        id: `chat:${JSON.stringify(btn.id)}`,
        label: btn.label,
      }),
    );

    const card = Card({
      ...(title ? { title } : {}),
      children: [
        CardText(body),
        ...(actionButtons.length > 0 ? [Actions(actionButtons)] : []),
      ],
    });

    // Store as an outgoing message in the conversation
    const msg = await insertMessage(deps.db, deps.realtime, {
      conversationId: inputData.conversationId,
      messageType: 'outgoing',
      contentType: 'interactive',
      content: body,
      contentData: { card },
      status: 'queued',
      senderId: agentId,
      senderType: 'agent',
    });

    await enqueueDelivery(deps.scheduler, msg.id);

    await deps.realtime
      .notify({
        table: 'conversations',
        id: inputData.conversationId,
        action: 'new-message',
      })
      .catch(() => {});

    return { success: true, message: 'Card sent.' };
  },
});
