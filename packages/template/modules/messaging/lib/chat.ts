import { RequestContext } from '@mastra/core/request-context';
import { notFound } from '@vobase/core';
import type { UIMessage } from 'ai';

import { getAgent } from '../../ai/agents';

export interface StreamChatOptions {
  agentId: string;
  messages: UIMessage[];
  thread: {
    id: string;
    contactId?: string | null;
    userId?: string | null;
  };
}

/**
 * Stream a chat response using a registered Mastra Agent.
 * The agent's DynamicArgument processors resolve moderation + memory
 * based on the requestContext passed here.
 */
export async function streamChat(options: StreamChatOptions) {
  const { agentId, messages, thread } = options;

  const registered = getAgent(agentId);
  if (!registered) throw notFound('Agent not found');

  const entries: [string, string][] = [
    ['threadId', thread.id],
    ['agentId', agentId],
    ['channel', 'web'],
  ];
  if (thread.contactId) entries.push(['contactId', thread.contactId]);
  if (thread.userId) entries.push(['userId', thread.userId]);
  const rc = new RequestContext(entries);

  // Pass memory option so Mastra Memory auto-persists messages for this thread.
  // Without thread + resource, Memory won't know where to store messages.
  const resourceId = thread.contactId ?? thread.userId ?? 'anonymous';

  // biome-ignore lint/suspicious/noExplicitAny: UIMessage[] compatible at runtime, type declarations diverge across Mastra/AI SDK package boundaries
  return registered.agent.stream(messages as any, {
    requestContext: rc,
    memory: {
      thread: thread.id,
      resource: resourceId,
    },
  });
}
