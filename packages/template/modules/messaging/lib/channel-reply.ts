import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

import { openai } from '@ai-sdk/openai';
import type { VobaseDb } from '@vobase/core';
import type { StorageService } from '@vobase/core';
import type { Scheduler } from '@vobase/core';
import { generateText, type LanguageModel, type ModelMessage, stepCountIs, type UserContent } from 'ai';

import { extractDocument } from '../../knowledge-base/lib/extract';
import { getAIConfig } from '../../../lib/ai';

import { msgAgents } from '../schema';
import { createEscalationTool } from './escalation';
import { createKnowledgeBaseTool } from './tools';

/**
 * Resolve a model ID to the correct AI SDK provider.
 */
async function resolveModel(modelId: string): Promise<LanguageModel> {
  if (modelId.startsWith('claude-')) {
    const { anthropic } = await import('@ai-sdk/anthropic');
    return anthropic(modelId);
  }
  if (modelId.startsWith('gemini-')) {
    const { google } = await import('@ai-sdk/google');
    return google(modelId);
  }
  return openai(modelId);
}

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
  thread: { id: string; agentId: string | null; channel: string };
  agent: typeof msgAgents.$inferSelect;
  messages: Array<{ aiRole: string | null; content: string | null; attachments: string | null }>;
}

/**
 * Download a non-image attachment from storage, extract text content using
 * the knowledge-base extraction pipeline (PDF, DOCX, XLSX, PPTX, HTML, etc.).
 * Falls back to a descriptive placeholder if extraction fails.
 */
async function extractAttachmentText(storage: StorageService, att: Attachment): Promise<string> {
  const label = att.filename ?? att.mimeType;
  try {
    const bucket = storage.bucket('chat-attachments');
    const data = await bucket.download(att.storageKey);

    // Write to temp file for extractDocument (it reads from disk)
    const tmpPath = join(tmpdir(), `msg-${Date.now()}-${att.storageKey.split('/').pop()}`);
    await Bun.write(tmpPath, data);

    try {
      const result = await extractDocument(tmpPath, att.mimeType);
      if (result.text) {
        return `[Document: ${label}]\n${result.text}`;
      }
    } finally {
      try { await unlink(tmpPath); } catch {}
    }
  } catch {
    // Extraction not available or failed
  }
  return `[Attached ${att.type}: ${label}]`;
}

/**
 * Generate an AI reply for external channels using generateText (not streamText).
 * External channels don't support streaming — collect full response, then send.
 */
export async function generateChannelReply(options: ChannelReplyOptions): Promise<string> {
  const { db, scheduler, storage, thread, agent, messages } = options;

  const config = getAIConfig();
  const modelId = agent.model ?? config.model;

  // Build AI messages — include image attachments as multimodal content parts
  const aiMessages: ModelMessage[] = [];

  for (const m of messages) {
    const role = (m.aiRole === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant';

    // Parse attachments
    const attachments: Attachment[] = m.attachments ? JSON.parse(m.attachments) : [];
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
          parts.push({ type: 'text', text: `[${att.type}: ${att.filename ?? 'image'}]` });
        }
      }

      // Extract text from non-image attachments (documents, audio descriptions)
      for (const att of attachments.filter((a) => !a.mimeType.startsWith('image/'))) {
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
      const nonImageAtts = attachments.filter((a) => !a.mimeType.startsWith('image/'));
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

  // Build tools based on agent config
  const tools: Record<string, ReturnType<typeof createKnowledgeBaseTool | typeof createEscalationTool>> = {};

  const enabledTools: string[] = agent.tools
    ? JSON.parse(agent.tools)
    : ['search_knowledge_base'];
  const kbSourceIds: string[] | undefined = agent.kbSourceIds
    ? JSON.parse(agent.kbSourceIds)
    : undefined;

  if (enabledTools.includes('search_knowledge_base')) {
    tools.search_knowledge_base = createKnowledgeBaseTool(db, kbSourceIds);
  }

  // Always include escalation tool for external channels
  tools.escalate_to_staff = createEscalationTool(db, scheduler, thread.id, thread.channel);

  const model = await resolveModel(modelId);
  const result = await generateText({
    model,
    system:
      agent.systemPrompt ??
      'You are a helpful assistant. When answering questions, search the knowledge base for relevant information and cite your sources.',
    messages: aiMessages,
    tools,
    stopWhen: stepCountIs(5),
  });

  return result.text;
}
