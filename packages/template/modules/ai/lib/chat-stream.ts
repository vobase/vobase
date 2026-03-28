/**
 * Chat streaming — web chat SSE response generation.
 *
 * Acquires a distributed lock, streams agent response, releases lock.
 * Used by the POST /chat handler for web-based conversations.
 *
 * Phase 2: Passes RequestContext with channel type so sendCard tool and
 *   processors can access channel type during streaming generation.
 */
import { RequestContext } from '@mastra/core/request-context';
import { logger } from '@vobase/core';

import { getAgent } from '../../../mastra/agents';
import { getChatState } from './chat-init';

interface StreamChatInput {
  conversationId: string;
  /** Last user message text — passed as a string to the agent. */
  message: string;
  agentId: string;
  resourceId: string;
  /** Contact or user ID for RequestContext. */
  contactId?: string | null;
  /** Channel type — defaults to 'web'. */
  channelType?: string;
}

/** Stream an agent response for web chat. Returns the Mastra stream result. */
export async function streamChat(input: StreamChatInput) {
  const {
    conversationId,
    message,
    agentId,
    resourceId,
    contactId,
    channelType,
  } = input;

  const registered = getAgent(agentId);
  if (!registered) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Acquire lock via state-pg to prevent concurrent generation
  const state = getChatState();
  const lock = await state.acquireLock(conversationId, 30_000);

  if (!lock) {
    throw new Error(
      `Conversation ${conversationId} is locked — concurrent generation in progress`,
    );
  }

  // Build RequestContext so sendCard tool and processors can access channel type
  const rc = new RequestContext();
  rc.set('conversationId', conversationId);
  rc.set('contactId', contactId ?? null);
  rc.set('channel', channelType ?? 'web');
  rc.set('agentId', agentId);

  try {
    // Pass as a string — agent + memory handles full conversation context
    const result = await registered.agent.stream(message, {
      memory: {
        thread: conversationId,
        resource: resourceId,
      },
      maxSteps: 5,
      requestContext: rc,
    });

    return result;
  } catch (err) {
    logger.error('[conversations] Stream generation failed', {
      conversationId,
      agentId,
      error: err,
    });
    throw err;
  } finally {
    await state.releaseLock(lock);
  }
}
