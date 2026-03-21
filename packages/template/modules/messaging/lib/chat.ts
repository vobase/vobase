import type { Scheduler, VobaseDb } from '@vobase/core';
import { notFound } from '@vobase/core';
import type { UIMessage } from 'ai';

import { getAgent } from '../../ai/agents';
import { createChatAgent } from '../../ai/lib/agents/chat-agent';

export interface StreamChatOptions {
  db: VobaseDb;
  scheduler: Scheduler;
  agentId: string;
  messages: UIMessage[];
  thread: {
    id: string;
    contactId?: string | null;
    userId?: string | null;
  };
}

/**
 * Stream a chat response using a Mastra Agent with tool calling.
 * Accepts UIMessage[] from useChat — Mastra handles conversion internally.
 * Returns a MastraModelOutput for stream conversion in the handler.
 */
export async function streamChat(options: StreamChatOptions) {
  const { db, scheduler, agentId, messages, thread } = options;

  // Look up agent from code registry
  const agent = getAgent(agentId);
  if (!agent) throw notFound('Agent not found');

  // Create a Mastra Agent from code config and stream
  const mastraAgent = createChatAgent({
    db,
    scheduler,
    agent,
    thread: {
      threadId: thread.id,
      contactId: thread.contactId,
      userId: thread.userId,
    },
  });
  // biome-ignore lint/suspicious/noExplicitAny: UIMessage[] compatible at runtime, type declarations diverge across Mastra/AI SDK package boundaries
  return mastraAgent.stream(messages as any);
}
