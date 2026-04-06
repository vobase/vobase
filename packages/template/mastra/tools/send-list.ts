/**
 * send_list — Mastra tool for sending interactive list messages.
 *
 * On channels that support lists (WhatsApp), emits a structured interactive
 * list payload that core's WhatsApp adapter passes directly to the API via
 * metadata.interactive. On unsupported channels (web), falls back to a
 * numbered plain-text representation. Returns an error string for agent
 * self-correction on validation failures.
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { getConstraints } from '../../modules/ai/lib/channel-constraints';

const rowSchema = z.object({
  id: z.string().describe('Unique row identifier'),
  title: z.string().describe('Row title shown to the user'),
  description: z.string().optional().describe('Optional subtitle/description'),
});

const sectionSchema = z.object({
  title: z.string().describe('Section header label'),
  rows: z.array(rowSchema).min(1).describe('Items within this section'),
});

export const sendListTool = createTool({
  id: 'send_list',
  description:
    'Send an interactive list message with selectable options grouped into sections. Use when you want the user to pick from a set of labelled choices. On channels that do not support lists, the options are sent as a numbered plain-text message instead.',
  inputSchema: z.object({
    body: z.string().describe('Introductory message body shown above the list'),
    buttonText: z
      .string()
      .describe(
        'Label on the button the user taps to open the list (WhatsApp only)',
      ),
    sections: z
      .array(sectionSchema)
      .min(1)
      .describe('Grouped sections of selectable rows'),
  }),
  outputSchema: z.object({
    payload: z
      .object({
        interactive: z.unknown().optional(),
        text: z.string().optional(),
      })
      .optional()
      .describe('Delivery payload on success'),
    error: z.string().optional().describe('Validation error — fix and retry'),
  }),
  execute: async (inputData, context) => {
    const channel =
      (context?.requestContext?.get('channel') as string | undefined) ?? 'web';
    const constraints = getConstraints(channel);
    const { body, buttonText, sections } = inputData;

    const totalItems = sections.reduce((sum, s) => sum + s.rows.length, 0);

    if (
      constraints.supportsLists &&
      constraints.maxListItems !== null &&
      totalItems > constraints.maxListItems
    ) {
      return {
        error: `${constraints.name} allows max ${constraints.maxListItems} list items, got ${totalItems}. Reduce the number of rows.`,
      };
    }

    if (constraints.supportsLists) {
      // Return structured interactive payload for channels that support it.
      // core's WhatsApp adapter forwards metadata.interactive directly to the API.
      return {
        payload: {
          interactive: {
            type: 'list',
            body: { text: body },
            action: {
              button: buttonText,
              sections,
            },
          },
        },
      };
    }

    // Fallback: numbered plain-text list for channels that don't support interactive lists.
    const lines: string[] = [body, ''];
    let index = 1;
    for (const section of sections) {
      if (section.title) {
        lines.push(section.title);
      }
      for (const row of section.rows) {
        const desc = row.description ? ` — ${row.description}` : '';
        lines.push(`${index}. ${row.title}${desc}`);
        index++;
      }
      lines.push('');
    }

    return {
      payload: {
        text: lines.join('\n').trimEnd(),
      },
    };
  },
});
