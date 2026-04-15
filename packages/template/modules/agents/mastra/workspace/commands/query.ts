import { unlink } from 'node:fs/promises';
import { hybridSearch } from '@modules/knowledge-base/lib/search';
import {
  channelInstances,
  conversations,
  messages,
} from '@modules/messaging/schema';
import { and, eq } from 'drizzle-orm';

import { models } from '../../lib/models';
import { getChatModel } from '../../lib/provider';
import { verifyConversationAccess } from '../lib/verify-conversation';
import { type CommandHandler, err, ok } from './types';

/**
 * vobase search <query>
 * Search the knowledge base and return relevant chunks with citations.
 */
const search: CommandHandler = async (positional, _flags, ctx) => {
  const query = positional.join(' ').trim();
  if (!query) return err('Usage: vobase search <query>');

  const results = await hybridSearch(ctx.db, query, {
    limit: 5,
    mode: 'deep',
  });

  if (results.length === 0) return ok('No relevant documents found.');

  const lines = ['## Results', ''];
  for (const r of results) {
    lines.push(`### ${r.documentTitle}`);
    lines.push(r.content);
    lines.push(`(score: ${r.score.toFixed(3)})`);
    lines.push('');
  }

  return ok(lines.join('\n'));
};

/**
 * vobase analyze-media <messageId> <question...>
 * Re-examine original media with a specific question.
 */
const analyzeMedia: CommandHandler = async (positional, _flags, ctx) => {
  const messageId = positional[0];
  if (!messageId)
    return err('Usage: vobase analyze-media <messageId> <question>');

  const question = positional.slice(1).join(' ').trim();
  if (!question)
    return err('Usage: vobase analyze-media <messageId> <question>');

  if (!ctx.deps.storage) return err('Storage service unavailable');

  // Load message
  const [row] = await ctx.db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      contentType: messages.contentType,
      contentData: messages.contentData,
    })
    .from(messages)
    .where(eq(messages.id, messageId));

  if (!row) return err('Message not found');

  // Verify access
  const check = await verifyConversationAccess(
    ctx.deps,
    row.conversationId,
    ctx.contactId,
  );
  if (!check.success) return err(check.message);

  const contentData = (row.contentData ?? {}) as Record<string, unknown>;
  const mediaArray =
    (contentData.media as Array<{
      storageKey?: string;
      mimeType: string;
    }>) ?? [];
  const firstMedia = mediaArray[0];

  if (!firstMedia?.storageKey) return err('Message has no downloadable media');

  const { generateText } = await import('ai');
  const bucket = ctx.deps.storage.bucket('chat-attachments');
  const data = await bucket.download(firstMedia.storageKey);
  const buffer = Buffer.from(data);

  if (row.contentType === 'image') {
    const sharp = (await import('sharp')).default;
    const { encodeToJpeg } = await import(
      '@modules/knowledge-base/lib/extract'
    );
    const { data: jpegBuffer } = await encodeToJpeg(sharp(buffer));
    const base64 = jpegBuffer.toString('base64');

    const result = await generateText({
      model: getChatModel(models.gemini_flash),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: question },
            { type: 'image', image: `data:image/jpeg;base64,${base64}` },
          ],
        },
      ],
    });

    return ok(result.text);
  }

  if (row.contentType === 'document') {
    const { extractDocument } = await import(
      '@modules/knowledge-base/lib/extract'
    );
    const { plateToMarkdown } = await import(
      '@modules/knowledge-base/lib/plate-serialize'
    );

    const tmpPath = `/tmp/analyze-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await Bun.write(tmpPath, buffer);
      const extraction = await extractDocument(tmpPath, firstMedia.mimeType);
      const markdown = plateToMarkdown(extraction.value);

      const result = await generateText({
        model: getChatModel(models.gemini_flash),
        messages: [
          {
            role: 'user',
            content: `Based on the following document content, answer this question: ${question}\n\n---\n\n${markdown}`,
          },
        ],
      });

      return ok(result.text);
    } finally {
      try {
        await unlink(tmpPath);
      } catch {
        // Temp file cleanup — non-critical
      }
    }
  }

  return err(`Media type '${row.contentType}' is not supported for analysis`);
};

/**
 * vobase list-conversations [--status <status>]
 * List conversations for the current contact.
 */
const listConversations: CommandHandler = async (_positional, flags, ctx) => {
  const conditions = [eq(conversations.contactId, ctx.contactId)];
  if (flags.status) {
    conditions.push(eq(conversations.status, flags.status));
  }

  const rows = await ctx.db
    .select({
      id: conversations.id,
      status: conversations.status,
      createdAt: conversations.createdAt,
      channelType: channelInstances.type,
    })
    .from(conversations)
    .leftJoin(
      channelInstances,
      eq(conversations.channelInstanceId, channelInstances.id),
    )
    .where(and(...conditions))
    .limit(20);

  if (rows.length === 0) return ok('No conversations found.');

  const header = 'ID | Status | Channel | Created';
  const separator = '---|--------|---------|--------';
  const lines = rows.map(
    (r) =>
      `${r.id} | ${r.status} | ${r.channelType ?? 'web'} | ${r.createdAt.toISOString()}`,
  );
  if (rows.length >= 20) lines.push('(showing first 20 — more may exist)');

  return ok([header, separator, ...lines].join('\n'));
};

/**
 * vobase recall <query>
 * Cross-conversation memory recall via vector search.
 * Stub: will be wired to PgVector once the embedding pipeline is in place.
 */
const recall: CommandHandler = async (positional) => {
  const query = positional.join(' ').trim();
  if (!query) return err('Usage: vobase recall <query>');

  return ok(
    'Recall not yet implemented — use search-kb for knowledge base queries.',
  );
};

/** All query command handlers keyed by subcommand name. */
export const queryCommands: Record<string, CommandHandler> = {
  'search-kb': search,
  'analyze-media': analyzeMedia,
  'list-conversations': listConversations,
  recall,
};
