/**
 * Channel reply generation — non-streaming AI response for channel sessions.
 *
 * Loads the session, checks for consultation replies, generates an agent
 * response using the inbound message, and enqueues the outbound message.
 */
import type { ChannelsService, Scheduler, VobaseDb } from '@vobase/core';
import { logger } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { getAgent } from '../../../mastra/agents';
import { channelInstances, sessions } from '../schema';
import { getChatState } from './chat-init';
import { enqueueMessage } from './outbox';

interface ReplyDeps {
  db: VobaseDb;
  scheduler: Scheduler;
  channels: ChannelsService;
}

/** Generate an AI reply for a channel session and enqueue for delivery. */
export async function generateChannelReply(
  deps: ReplyDeps,
  sessionId: string,
  inboundContent?: string,
): Promise<string | null> {
  const { db, scheduler } = deps;

  // Load session
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session || session.status !== 'active') {
    logger.warn('[conversations] Cannot generate reply for inactive session', {
      sessionId,
      status: session?.status,
    });
    return null;
  }

  // Get agent
  const registered = getAgent(session.agentId);
  if (!registered) {
    logger.error('[conversations] Agent not found', {
      agentId: session.agentId,
    });
    return null;
  }

  // Check for consultation reply in chat state
  const state = getChatState();
  const consultationReply = await state.get<{
    reply?: string;
    timeout?: boolean;
    staffId?: string;
  }>(`consultation:${sessionId}`);

  // Build the message to send to the agent
  let messageContent = inboundContent ?? '';

  if (consultationReply) {
    if (consultationReply.reply) {
      messageContent += `\n\n[Staff consultation reply]: ${consultationReply.reply}`;
    } else if (consultationReply.timeout) {
      messageContent +=
        '\n\n[System]: Staff consultation timed out. Please proceed with your best judgment or inform the customer.';
    }
    await state.delete(`consultation:${sessionId}`);
  }

  if (!messageContent) {
    return null;
  }

  // Generate response using agent (non-streaming for channels)
  // Pass as a string — the agent + memory will handle context retrieval
  try {
    const response = await registered.agent.generate(messageContent, {
      memory: {
        thread: sessionId,
        resource: `contact:${session.contactId}`,
      },
      maxSteps: 5,
    });

    const responseText =
      typeof response.text === 'string' ? response.text : String(response.text);

    if (!responseText) return null;

    // Enqueue outbound message via outbox
    // Resolve channel type from instance
    const [instance] = session.channelInstanceId
      ? await db
          .select({ type: channelInstances.type })
          .from(channelInstances)
          .where(eq(channelInstances.id, session.channelInstanceId))
      : [];

    await enqueueMessage(db, scheduler, {
      sessionId,
      content: responseText,
      channelType: instance?.type ?? 'web',
      channelInstanceId: session.channelInstanceId,
    });

    return responseText;
  } catch (err) {
    logger.error('[conversations] Agent generation failed', {
      sessionId,
      agentId: session.agentId,
      error: err,
    });

    // Enqueue a fallback message so the customer is not left without a response
    const [instance] = session.channelInstanceId
      ? await db
          .select({ type: channelInstances.type })
          .from(channelInstances)
          .where(eq(channelInstances.id, session.channelInstanceId))
      : [];

    await enqueueMessage(db, scheduler, {
      sessionId,
      content:
        "We're experiencing a temporary issue. Please try again shortly.",
      channelType: instance?.type ?? 'web',
      channelInstanceId: session.channelInstanceId,
    });

    return null;
  }
}
