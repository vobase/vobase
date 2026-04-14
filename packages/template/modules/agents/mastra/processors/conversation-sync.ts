/**
 * ConversationSyncProcessor — Mastra input processor that injects conversation
 * messages (including images as multipart content) into the agent's context.
 *
 * Messages are added with source 'memory' so MessageHistory never persists them
 * to mastra.mastra_messages — the messaging.messages table remains the single
 * source of truth for conversation content.
 */
import type {
  InputProcessor,
  ProcessInputArgs,
  ProcessInputResult,
} from '@mastra/core/processors';
import type { StorageService } from '@vobase/core';
import { logger } from '@vobase/core';
import { and, desc, eq, ne } from 'drizzle-orm';

import type { ModuleDeps } from '../../../messaging/lib/deps';
import { messages } from '../../../messaging/schema';

const DEFAULT_LIMIT = 30;

interface MediaEntry {
  type: string;
  url: string;
  storageKey?: string;
  mimeType: string;
  filename?: string;
}

/** Build message content parts for an image, downloading bytes from storage. */
async function buildImageParts(
  storage: StorageService | undefined,
  contentData: Record<string, unknown>,
  messageId: string,
): Promise<Array<{ type: string; text?: string; image?: string }>> {
  const mediaArray = (contentData?.media as MediaEntry[] | undefined) ?? [];
  const firstMedia = mediaArray[0];

  if (!firstMedia || !storage) {
    return [
      {
        type: 'text',
        text: '(customer sent an image — temporarily unavailable)',
      },
    ];
  }

  // Resolve storage key: new messages have storageKey, legacy messages need URL path extraction
  const storageKey =
    firstMedia.storageKey ?? extractStorageKeyFromUrl(firstMedia.url);

  if (!storageKey) {
    return [
      {
        type: 'text',
        text: '(customer sent an image — visible in prior messages)',
      },
    ];
  }

  try {
    const bucket = storage.bucket('chat-attachments');
    const data = await bucket.download(storageKey);
    const mimeType = firstMedia.mimeType || 'image/jpeg';
    const base64 = Buffer.from(data).toString('base64');
    return [{ type: 'image', image: `data:${mimeType};base64,${base64}` }];
  } catch (err) {
    logger.warn('[ConversationSync] image download failed', {
      messageId,
      storageKey,
      error: err,
    });
    return [
      {
        type: 'text',
        text: '(customer sent an image — temporarily unavailable)',
      },
    ];
  }
}

/**
 * Attempt to extract the storage key from a presigned URL path.
 * Presigned URLs from the local adapter look like: /storage/chat-attachments/convId/msgId/file.jpg?...
 * S3 URLs look like: https://bucket.s3.region.amazonaws.com/convId/msgId/file.jpg?...
 */
function extractStorageKeyFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    // Strip query params
    const path = url.split('?')[0];
    // For local storage: /storage/chat-attachments/key... → extract after bucket name
    const localMatch = path.match(/\/storage\/chat-attachments\/(.+)/);
    if (localMatch) return localMatch[1];
    // For S3: extract path after domain
    const urlObj = new URL(url);
    const s3Path = urlObj.pathname.replace(/^\//, '');
    return s3Path || null;
  } catch {
    return null;
  }
}

/** Map a conversation message row to an AI SDK CoreMessage for injection. */
async function rowToMessage(
  row: {
    id: string;
    senderType: string;
    content: string;
    contentType: string;
    contentData: unknown;
    caption: string | null;
  },
  storage: StorageService | undefined,
  hasAgentContext: boolean,
): Promise<{ role: 'user' | 'assistant'; content: unknown } | null> {
  // Map sender type to role
  const role: 'user' | 'assistant' =
    row.senderType === 'agent' ? 'assistant' : 'user';

  // Staff echo messages get a prefix
  const staffPrefix = row.senderType === 'user' ? '[Staff] ' : '';

  // Build content based on content type
  switch (row.contentType) {
    case 'text':
    case 'interactive':
      return { role, content: `${staffPrefix}${row.content}` };

    case 'image': {
      const data = (row.contentData ?? {}) as Record<string, unknown>;
      const metadata = data.metadata as Record<string, unknown> | undefined;

      // Caption-first: on subsequent wakes, use caption instead of raw image download
      if (row.caption && hasAgentContext) {
        return { role, content: `${staffPrefix}[Image] ${row.caption}` };
      }

      // Media download failed — no binary to presign
      if (metadata?.mediaDownloadFailed || !(data.media as unknown[])?.[0]) {
        return {
          role,
          content: `${staffPrefix}(customer sent an image — media download failed, not viewable)`,
        };
      }
      const parts = await buildImageParts(storage, data, row.id);
      if (staffPrefix) {
        parts.unshift({ type: 'text', text: staffPrefix });
      }
      return { role, content: parts };
    }

    case 'video':
      if (row.caption) {
        return { role, content: `${staffPrefix}${row.caption}` };
      }
      return {
        role,
        content: `${staffPrefix}(customer sent a video — not viewable, ask about the content if relevant)`,
      };

    case 'audio':
      if (row.caption) {
        return { role, content: `${staffPrefix}${row.caption}` };
      }
      return {
        role,
        content: `${staffPrefix}(customer sent a voice message — not playable, ask them to summarize if relevant)`,
      };

    case 'document':
      if (row.caption) {
        return { role, content: `${staffPrefix}[Document] ${row.caption}` };
      }
      return {
        role,
        content: `${staffPrefix}(customer sent a document — not readable, ask them to describe what they need)`,
      };

    case 'sticker':
      return { role, content: `${staffPrefix}(customer sent a sticker)` };

    default:
      return { role, content: `${staffPrefix}${row.content}` };
  }
}

/**
 * Input processor that syncs conversation messages into the agent's context.
 * Runs before moderation so conversation content is available for moderation decisions.
 */
export function createConversationSyncProcessor(
  limit = DEFAULT_LIMIT,
): InputProcessor {
  return {
    id: 'conversation-sync',

    async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
      const { messageList, requestContext } = args;

      const conversationId = requestContext?.get?.('conversationId') as
        | string
        | undefined;
      if (!conversationId) return messageList;

      const deps = requestContext?.get?.('deps') as ModuleDeps | undefined;
      if (!deps) return messageList;

      const storage = deps.storage;

      // Fetch recent conversation messages, excluding system and private
      const rows = await deps.db
        .select({
          id: messages.id,
          senderType: messages.senderType,
          content: messages.content,
          contentType: messages.contentType,
          contentData: messages.contentData,
          caption: messages.caption,
        })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            ne(messages.contentType, 'system'),
            eq(messages.private, false),
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(limit);

      // Reverse to chronological order (query fetches newest-first for correct truncation)
      rows.reverse();

      if (rows.length === 0) return messageList;

      // Detect whether agent has prior context — if so, use captions instead of raw images
      const hasAgentContext = rows.some((r) => r.senderType === 'agent');

      // Convert to AI SDK messages and inject with source 'memory'
      const results = await Promise.all(
        rows.map((row) => rowToMessage(row, storage, hasAgentContext)),
      );
      const converted = results.filter(
        (m): m is NonNullable<typeof m> => m !== null,
      );

      if (converted.length > 0) {
        messageList.add(converted, 'memory');
      }

      return messageList;
    },
  };
}
