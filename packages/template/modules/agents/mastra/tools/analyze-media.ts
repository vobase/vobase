import { unlink } from 'node:fs/promises';
import { createTool } from '@mastra/core/tools';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { z } from 'zod';

import {
  encodeToJpeg,
  extractDocument,
} from '../../../knowledge-base/lib/extract';
import { plateToMarkdown } from '../../../knowledge-base/lib/plate-serialize';
import type { ModuleDeps } from '../../../messaging/lib/deps';
import { messages } from '../../../messaging/schema';
import { models } from '../lib/models';
import { getChatModel } from '../lib/provider';
import { verifyConversationAccess } from './_verify-conversation';

/**
 * On-demand media analysis tool — lets the agent re-examine original media
 * with a specific question when the pre-processed caption is insufficient.
 */
export const analyzeMediaTool = createTool({
  id: 'analyze_media',
  description:
    'Analyze an image or document in detail. Use when you need to answer a specific question about media content, extract specific information, or when the automatic caption is insufficient.',
  inputSchema: z.object({
    messageId: z.string().describe('The message ID containing the media'),
    question: z
      .string()
      .describe('The specific question to answer about the media'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    answer: z.string().optional(),
    mediaType: z.string().optional(),
    message: z.string().optional(),
  }),
  execute: async (input, context) => {
    const deps = context?.requestContext?.get('deps') as ModuleDeps | undefined;
    if (!deps) {
      return { success: false, message: 'No deps context available' };
    }

    const contactId = context?.requestContext?.get('contactId') as
      | string
      | undefined;
    if (!contactId) {
      return { success: false, message: 'No contact context available' };
    }

    if (!deps.storage) {
      return { success: false, message: 'Storage service unavailable' };
    }

    // Load message
    const [row] = await deps.db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        contentType: messages.contentType,
        contentData: messages.contentData,
      })
      .from(messages)
      .where(eq(messages.id, input.messageId));

    if (!row) {
      return { success: false, message: 'Message not found' };
    }

    // Verify access
    const check = await verifyConversationAccess(
      deps,
      row.conversationId,
      contactId,
    );
    if (!check.success) return { success: false, message: check.message };

    const contentData = (row.contentData ?? {}) as Record<string, unknown>;
    const mediaArray =
      (contentData.media as Array<{
        storageKey?: string;
        mimeType: string;
      }>) ?? [];
    const firstMedia = mediaArray[0];

    if (!firstMedia?.storageKey) {
      return { success: false, message: 'Message has no downloadable media' };
    }

    try {
      const { generateText } = await import('ai');
      const bucket = deps.storage.bucket('chat-attachments');
      const data = await bucket.download(firstMedia.storageKey);
      const buffer = Buffer.from(data);

      if (row.contentType === 'image') {
        // Vision analysis for images
        const { data: jpegBuffer } = await encodeToJpeg(sharp(buffer));
        const base64 = jpegBuffer.toString('base64');

        const result = await generateText({
          model: getChatModel(models.gemini_flash),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: input.question },
                {
                  type: 'image',
                  image: `data:image/jpeg;base64,${base64}`,
                },
              ],
            },
          ],
        });

        return {
          success: true,
          answer: result.text,
          mediaType: 'image',
        };
      }

      if (row.contentType === 'document') {
        // Text extraction + question answering for documents
        const tmpPath = `/tmp/analyze-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        try {
          await Bun.write(tmpPath, buffer);

          const extraction = await extractDocument(
            tmpPath,
            firstMedia.mimeType,
          );
          const markdown = plateToMarkdown(extraction.value);

          const result = await generateText({
            model: getChatModel(models.gemini_flash),
            messages: [
              {
                role: 'user',
                content: `Based on the following document content, answer this question: ${input.question}\n\n---\n\n${markdown}`,
              },
            ],
          });

          return {
            success: true,
            answer: result.text,
            mediaType: 'document',
          };
        } finally {
          try {
            await unlink(tmpPath);
          } catch {
            // Temp file cleanup — non-critical
          }
        }
      }

      return {
        success: false,
        message: `Media type '${row.contentType}' is not supported for analysis`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }
  },
});
