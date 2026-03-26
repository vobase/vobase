/**
 * Channel reply generation — non-streaming AI response for channel sessions.
 *
 * Loads the session, checks for consultation replies, generates an agent
 * response using the inbound message, and enqueues the outbound message.
 *
 * Phase 2: Injects RequestContext with channel type so sendCard tool and
 *   processors can access channel type during generation.
 * Phase 3: Extracts CardElement results from sendCard tool calls and routes
 *   them through serializeCard() → outbox pipeline.
 */

import { RequestContext } from '@mastra/core/request-context';
import type { ChannelsService, Scheduler, VobaseDb } from '@vobase/core';
import { logger } from '@vobase/core';
import type { CardElement } from 'chat';
import { eq } from 'drizzle-orm';

import { getAgent } from '../../../mastra/agents';
import { channelInstances, sessions } from '../schema';
import { formatConstraintsForPrompt } from './channel-constraints';
import { serializeCard } from './chat-bridge';
import { getChatState } from './chat-init';
import { enqueueMessage } from './outbox';

interface ReplyDeps {
  db: VobaseDb;
  scheduler: Scheduler;
  channels: ChannelsService;
}

// ─── CardElement extraction ──────────────────────────────────────────

/**
 * Extract CardElement results from sendCard tool calls in the agent response.
 *
 * Mastra ToolResultChunk shape: { type: 'tool-result', payload: ToolResultPayload }
 * ToolResultPayload: { toolCallId, toolName, result, isError? }
 * NOTE: .payload nesting is real — see @mastra/core/dist/stream/types.d.ts
 * NOTE: result field is .result (not .output — that is the AI SDK frontend type)
 */
export function extractSendCardResults(response: {
  steps?: unknown[];
  toolResults?: unknown[];
}): CardElement[] {
  const cards: CardElement[] = [];

  if (!response.steps || !Array.isArray(response.steps)) {
    logger.warn(
      '[conversations] extractSendCardResults: response.steps is missing or not an array — possible Mastra API drift',
    );
    return cards;
  }

  for (const step of response.steps) {
    const s = step as Record<string, unknown>;
    if (!s.toolResults || !Array.isArray(s.toolResults)) continue;

    for (const tr of s.toolResults as unknown[]) {
      const result = tr as Record<string, unknown>;

      if (!result.payload) {
        logger.warn(
          '[conversations] extractSendCardResults: toolResult missing .payload — possible Mastra API drift',
          { tr },
        );
        continue;
      }

      const payload = result.payload as Record<string, unknown>;
      if (
        payload.toolName === 'send_card' &&
        !payload.isError &&
        payload.result &&
        (payload.result as Record<string, unknown>).card
      ) {
        cards.push(
          (payload.result as Record<string, unknown>).card as CardElement,
        );
      }
    }
  }

  // Fallback: check top-level response.toolResults
  if (
    cards.length === 0 &&
    response.toolResults &&
    Array.isArray(response.toolResults)
  ) {
    for (const tr of response.toolResults as unknown[]) {
      const result = tr as Record<string, unknown>;
      const payload = result.payload as Record<string, unknown> | undefined;
      if (
        payload?.toolName === 'send_card' &&
        !payload.isError &&
        payload.result &&
        (payload.result as Record<string, unknown>).card
      ) {
        cards.push(
          (payload.result as Record<string, unknown>).card as CardElement,
        );
      }
    }
  }

  return cards;
}

// ─── Main function ───────────────────────────────────────────────────

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

  // Resolve channel type early (needed for context injection and card routing)
  const [instance] = session.channelInstanceId
    ? await db
        .select({ type: channelInstances.type })
        .from(channelInstances)
        .where(eq(channelInstances.id, session.channelInstanceId))
    : [];
  const channelType = instance?.type ?? 'web';

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

  // Prepend channel constraints so the agent tailors card structure per channel
  const constraintText = formatConstraintsForPrompt(channelType);
  const contextPrefix = `[Channel: ${channelType}]\n${constraintText}\n\n`;

  // Build RequestContext so sendCard tool and processors can access channel type
  const rc = new RequestContext();
  rc.set('conversationId', sessionId);
  rc.set('contactId', session.contactId);
  rc.set('channel', channelType);
  rc.set('agentId', session.agentId);

  // Generate response using agent (non-streaming for channels)
  try {
    const response = await registered.agent.generate(
      contextPrefix + messageContent,
      {
        memory: {
          thread: sessionId,
          resource: `contact:${session.contactId}`,
        },
        maxSteps: 5,
        requestContext: rc,
      },
    );

    // Extract sendCard tool results and route through serialization pipeline
    const cardElements = extractSendCardResults(
      response as {
        steps?: unknown[];
        toolResults?: unknown[];
      },
    );

    for (const cardElement of cardElements) {
      const serialized = serializeCard(cardElement);
      await enqueueMessage(db, scheduler, {
        sessionId,
        content: serialized.content,
        channelType,
        channelInstanceId: session.channelInstanceId,
        payload: serialized.payload,
      });
    }

    // Also enqueue any text response (agent may combine text + cards)
    const responseText =
      typeof response.text === 'string'
        ? response.text
        : String(response.text ?? '');

    if (responseText) {
      await enqueueMessage(db, scheduler, {
        sessionId,
        content: responseText,
        channelType,
        channelInstanceId: session.channelInstanceId,
      });
    }

    return responseText || null;
  } catch (err) {
    logger.error('[conversations] Agent generation failed', {
      sessionId,
      agentId: session.agentId,
      error: err,
    });

    // Enqueue a fallback message so the customer is not left without a response
    await enqueueMessage(db, scheduler, {
      sessionId,
      content:
        "We're experiencing a temporary issue. Please try again shortly.",
      channelType,
      channelInstanceId: session.channelInstanceId,
    });

    return null;
  }
}
