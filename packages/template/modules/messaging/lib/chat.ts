import { openai } from '@ai-sdk/openai';
import type { VobaseDb } from '@vobase/core';
import {
  convertToModelMessages,
  type LanguageModel,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai';
import { eq } from 'drizzle-orm';

import { getAIConfig } from '../../../lib/ai';
import { msgAgents } from '../schema';
import { createKnowledgeBaseTool } from './tools';

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
  agentId: string;
  messages: UIMessage[];
}

/**
 * Stream a chat response using AI SDK with tool calling and agent loops.
 * Accepts UIMessage[] from useChat — uses convertToModelMessages for the LLM call.
 */
export async function streamChat(options: StreamChatOptions) {
  const { db, agentId, messages } = options;

  // Load agent config
  const agent = (
    await db.select().from(msgAgents).where(eq(msgAgents.id, agentId))
  )[0];

  const config = getAIConfig();
  const modelId = agent?.model ?? config.model;

  // Build tools based on agent config
  const tools: Record<string, ReturnType<typeof createKnowledgeBaseTool>> = {};

  const enabledTools: string[] = agent?.tools
    ? JSON.parse(agent.tools)
    : ['search_knowledge_base'];
  const kbSourceIds: string[] | undefined = agent?.kbSourceIds
    ? JSON.parse(agent.kbSourceIds)
    : undefined;

  if (enabledTools.includes('search_knowledge_base')) {
    tools.search_knowledge_base = createKnowledgeBaseTool(db, kbSourceIds);
  }

  // Convert UIMessages to model messages
  const modelMessages = await convertToModelMessages(messages);

  // Stream the response with agent loops
  const model = await resolveModel(modelId);
  const result = streamText({
    model,
    system:
      agent?.systemPrompt ??
      'You are a helpful assistant. When answering questions, search the knowledge base for relevant information and cite your sources.',
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
  });

  return result;
}
