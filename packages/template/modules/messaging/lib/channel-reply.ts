import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestContext } from '@mastra/core/request-context';
import type { Scheduler, StorageService, VobaseDb } from '@vobase/core';
import type { ModelMessage, UserContent } from 'ai';

import { getAgent } from '../../../mastra/agents';
import { extractDocument } from '../../knowledge-base/lib/extract';

interface Attachment {
  storageKey: string;
  type: string;
  mimeType: string;
  filename?: string;
  size: number;
}

interface ChannelReplyOptions {
  db: VobaseDb;
  scheduler: Scheduler;
  storage?: StorageService;
  thread: {
    id: string;
    agentId: string | null;
    channel: string;
    contactId?: string | null;
    userId?: string | null;
  };
  messages: Array<{
    aiRole: string | null;
    content: string | null;
    attachments: string | null;
  }>;
}

/**
 * Download a non-image attachment from storage, extract text content using
 * the knowledge-base extraction pipeline (PDF, DOCX, XLSX, PPTX, HTML, etc.).
 * Falls back to a descriptive placeholder if extraction fails.
 */
async function extractAttachmentText(
  storage: StorageService,
  att: Attachment,
): Promise<string> {
  const label = att.filename ?? att.mimeType;
  try {
    const bucket = storage.bucket('chat-attachments');
    const data = await bucket.download(att.storageKey);

    // Write to temp file for extractDocument (it reads from disk)
    const tmpPath = join(
      tmpdir(),
      `msg-${Date.now()}-${att.storageKey.split('/').pop()}`,
    );
    await Bun.write(tmpPath, data);

    try {
      const result = await extractDocument(tmpPath, att.mimeType);
      if (result.text) {
        return `[Document: ${label}]\n${result.text}`;
      }
    } finally {
      try {
        await unlink(tmpPath);
      } catch {}
    }
  } catch {
    // Extraction not available or failed
  }
  return `[Attached ${att.type}: ${label}]`;
}

/**
 * Generate an AI reply for external channels using a Mastra Agent (non-streaming).
 * External channels don't support streaming — collect full response, then send.
 */
export async function generateChannelReply(
  options: ChannelReplyOptions,
): Promise<string> {
  const { storage, thread, messages } = options;

  // Look up the registered agent
  const registered = thread.agentId ? getAgent(thread.agentId) : undefined;
  if (!registered) return '';

  // Build AI messages — include image attachments as multimodal content parts
  const aiMessages: ModelMessage[] = [];

  for (const m of messages) {
    const role = (m.aiRole === 'assistant' ? 'assistant' : 'user') as
      | 'user'
      | 'assistant';

    // Parse attachments
    const attachments: Attachment[] = m.attachments
      ? JSON.parse(m.attachments)
      : [];
    const imageAttachments = attachments.filter((a) =>
      a.mimeType.startsWith('image/'),
    );

    // If user message has images and we have storage, build multimodal content
    if (role === 'user' && imageAttachments.length > 0 && storage) {
      const parts: UserContent = [];

      if (m.content) {
        parts.push({ type: 'text', text: m.content });
      }

      const bucket = storage.bucket('chat-attachments');
      for (const att of imageAttachments) {
        try {
          const data = await bucket.download(att.storageKey);
          parts.push({ type: 'image', image: data, mediaType: att.mimeType });
        } catch {
          // If download fails, describe the attachment as text
          parts.push({
            type: 'text',
            text: `[${att.type}: ${att.filename ?? 'image'}]`,
          });
        }
      }

      // Extract text from non-image attachments (documents, audio descriptions)
      for (const att of attachments.filter(
        (a) => !a.mimeType.startsWith('image/'),
      )) {
        const extracted = await extractAttachmentText(storage, att);
        parts.push({ type: 'text', text: extracted });
      }

      if (parts.length > 0) {
        aiMessages.push({ role: 'user', content: parts });
      }
    } else if (m.content || attachments.length) {
      // Text-only message, assistant message, or document-only message
      let text = m.content ?? '';
      // Extract text from non-image attachments
      const nonImageAtts = attachments.filter(
        (a) => !a.mimeType.startsWith('image/'),
      );
      if (nonImageAtts.length && storage) {
        for (const att of nonImageAtts) {
          const extracted = await extractAttachmentText(storage, att);
          text += (text ? '\n' : '') + extracted;
        }
      }
      if (text) {
        aiMessages.push({ role, content: text });
      }
    }
  }

  const entries: [string, string][] = [
    ['threadId', thread.id],
    ['channel', thread.channel],
  ];
  if (thread.agentId) entries.push(['agentId', thread.agentId]);
  if (thread.contactId) entries.push(['contactId', thread.contactId]);
  if (thread.userId) entries.push(['userId', thread.userId]);
  const rc = new RequestContext(entries);

  // Pass memory option so Mastra Memory auto-persists messages for this thread.
  const resourceId = thread.contactId ?? thread.userId ?? 'anonymous';

  // biome-ignore lint/suspicious/noExplicitAny: ModelMessage[] compatible at runtime, type declarations diverge across Mastra/AI SDK package boundaries
  const result = await registered.agent.generate(aiMessages as any, {
    requestContext: rc,
    memory: {
      thread: thread.id,
      resource: resourceId,
    },
  });
  return result.text;
}
