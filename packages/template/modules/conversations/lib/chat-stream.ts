/**
 * Chat streaming — web chat SSE response generation.
 *
 * Acquires a distributed lock, streams agent response, releases lock.
 * Used by the POST /chat handler for web-based sessions.
 */
import { logger } from '@vobase/core';

import { getAgent } from '../../../mastra/agents';
import { getChatState } from './chat-init';

interface StreamChatInput {
  sessionId: string;
  /** Last user message text — passed as a string to the agent. */
  message: string;
  agentId: string;
  resourceId: string;
}

/** Stream an agent response for web chat. Returns the Mastra stream result. */
export async function streamChat(input: StreamChatInput) {
  const { sessionId, message, agentId, resourceId } = input;

  const registered = getAgent(agentId);
  if (!registered) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Acquire lock via state-pg to prevent concurrent generation
  const state = getChatState();
  const lock = await state.acquireLock(sessionId, 30_000);

  if (!lock) {
    throw new Error(
      `Session ${sessionId} is locked — concurrent generation in progress`,
    );
  }

  try {
    // Pass as a string — agent + memory handles full conversation context
    const result = await registered.agent.stream(message, {
      memory: {
        thread: sessionId,
        resource: resourceId,
      },
      maxSteps: 5,
    });

    return result;
  } catch (err) {
    logger.error('[conversations] Stream generation failed', {
      sessionId,
      agentId,
      error: err,
    });
    throw err;
  } finally {
    await state.releaseLock(lock);
  }
}
