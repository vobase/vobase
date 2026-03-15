import { streamText, stepCountIs, type LanguageModel } from 'ai';
import { openai } from '@ai-sdk/openai';
import { eq } from 'drizzle-orm';
import type { VobaseDb } from '@vobase/core';
import { chatAssistants, chatMessages } from '../schema';
import { createKnowledgeBaseTool } from './tools';
import { getAIConfig } from '../../../lib/ai';

/**
 * Resolve a model ID to the correct AI SDK provider.
 * Supports OpenAI (gpt-*), Anthropic (claude-*), and Google (gemini-*) models.
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

export interface StreamChatOptions {
  db: VobaseDb;
  threadId: string;
  assistantId: string;
  userMessage: string;
}

/**
 * Stream a chat response using AI SDK with tool calling and agent loops.
 */
export async function streamChat(options: StreamChatOptions) {
  const { db, threadId, assistantId, userMessage } = options;

  // Load assistant config
  const assistant = await db
    .select()
    .from(chatAssistants)
    .where(eq(chatAssistants.id, assistantId))
    .get();

  const config = getAIConfig();
  const modelId = assistant?.model ?? config.model;

  // Build message history
  const history = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(chatMessages.createdAt);

  const messages = history.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content ?? '',
  }));

  // Add current user message
  messages.push({ role: 'user', content: userMessage });

  // Build tools based on assistant config
  const tools: Record<string, ReturnType<typeof createKnowledgeBaseTool>> = {};

  const enabledTools: string[] = assistant?.tools
    ? JSON.parse(assistant.tools)
    : ['search_knowledge_base'];
  const kbSourceIds: string[] | undefined = assistant?.kbSourceIds
    ? JSON.parse(assistant.kbSourceIds)
    : undefined;

  if (enabledTools.includes('search_knowledge_base')) {
    tools.search_knowledge_base = createKnowledgeBaseTool(db, kbSourceIds);
  }

  // Stream the response with agent loops (stopWhen)
  const model = await resolveModel(modelId);
  const result = streamText({
    model,
    system:
      assistant?.systemPrompt ??
      'You are a helpful assistant. When answering questions, search the knowledge base for relevant information and cite your sources.',
    messages,
    tools,
    stopWhen: stepCountIs(5), // Allow up to 5 tool-calling rounds
  });

  return result;
}
