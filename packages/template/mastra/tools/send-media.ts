/**
 * send_media — Mastra tool for sending media messages (image, document, audio, video).
 *
 * Validates the requested media type against per-channel constraints and returns
 * a media payload for the delivery pipeline via core's OutboundMessage.media contract.
 * Returns an error string for agent self-correction on unsupported media types.
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { getConstraints } from '../../modules/ai/lib/channel-constraints';

export const sendMediaTool = createTool({
  id: 'send_media',
  description:
    'Send a media file (image, document, audio, or video) to the user. Validates the media type against channel capabilities before sending. Use caption to add context to the media.',
  inputSchema: z.object({
    type: z
      .enum(['image', 'document', 'audio', 'video'])
      .describe('Media type to send'),
    url: z.string().url().describe('Publicly accessible URL of the media file'),
    caption: z
      .string()
      .optional()
      .describe('Optional caption displayed alongside the media'),
    filename: z
      .string()
      .optional()
      .describe('Optional filename hint for document downloads'),
  }),
  outputSchema: z.object({
    media: z
      .object({
        type: z.enum(['image', 'document', 'audio', 'video']),
        url: z.string(),
        caption: z.string().optional(),
        filename: z.string().optional(),
      })
      .optional()
      .describe('Media payload for the delivery pipeline on success'),
    error: z.string().optional().describe('Validation error — fix and retry'),
  }),
  execute: async (inputData, context) => {
    const channel =
      (context?.requestContext?.get('channel') as string | undefined) ?? 'web';
    const constraints = getConstraints(channel);
    const { type, url, caption, filename } = inputData;

    if (!constraints.supportsMedia.includes(type)) {
      const supported =
        constraints.supportsMedia.length > 0
          ? constraints.supportsMedia.join(', ')
          : 'none';
      return {
        error: `${constraints.name} does not support ${type} media. Supported types: ${supported}.`,
      };
    }

    return {
      media: {
        type,
        url,
        ...(caption !== undefined ? { caption } : {}),
        ...(filename !== undefined ? { filename } : {}),
      },
    };
  },
});
