import type { Scheduler, VobaseDb } from '@vobase/core';
import { notFound } from '@vobase/core';
import type { UIMessage } from 'ai';
import { eq } from 'drizzle-orm';

import { msgAgents } from '../schema';
import { createChatAgent } from './agents';

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

  // Load agent config from DB
  const agent = (
    await db.select().from(msgAgents).where(eq(msgAgents.id, agentId))
  )[0];
  if (!agent) throw notFound('Agent not found');

  // Create a Mastra Agent from DB config and stream
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
