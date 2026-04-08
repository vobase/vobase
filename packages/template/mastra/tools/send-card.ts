/**
 * send_card — Mastra tool for sending structured interactive cards.
 *
 * Accepts a simplified flat schema (LLM-friendly), validates against
 * per-channel constraints, and builds a CardElement using local card primitives.
 * Returns an error string for agent self-correction on validation failures.
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import {
  Actions,
  Button,
  Card,
  CardText,
} from '../../modules/ai/lib/card-serialization';
import { getConstraints } from '../../modules/ai/lib/channel-constraints';

export const sendCardTool = createTool({
  id: 'send_card',
  description:
    'Send an interactive card with optional buttons to the user. Use when you want to present structured information or interactive choices. The card can include a title, body text, and up to several reply buttons.',
  inputSchema: z.object({
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
    card: z.unknown().optional().describe('CardElement on success'),
    error: z.string().optional().describe('Validation error — fix and retry'),
  }),
  execute: async (inputData, context) => {
    const channel =
      (context?.requestContext?.get('channel') as string | undefined) ?? 'web';
    const constraints = getConstraints(channel);
    const { title, body, buttons } = inputData;

    // Validate body length
    if (body.length > constraints.maxBodyLength) {
      return {
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
        error: `${constraints.name} allows max ${constraints.maxButtons} buttons, got ${buttons.length}. Reduce button count.`,
      };
    }

    // Validate individual button label lengths
    if (buttons) {
      for (const btn of buttons) {
        if (btn.label.length > constraints.maxButtonLabelLength) {
          return {
            error: `${constraints.name} button labels must be ${constraints.maxButtonLabelLength} characters or less. Button "${btn.id}" label "${btn.label}" is ${btn.label.length} characters. Shorten it.`,
          };
        }
      }
    }

    // Build CardElement using local card primitives.
    // Button IDs use chat:${JSON.stringify(id)} to match the existing convention
    // in buildInteractiveCard() (chat-cards.ts:72), ensuring the onAction handler
    // in inbound.ts (which does JSON.parse(actionId.slice(5))) works as-is.
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

    return { card };
  },
});
