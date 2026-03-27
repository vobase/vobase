import { RequestContext } from '@mastra/core/request-context';
import type { ChannelsService, Scheduler, VobaseDb } from '@vobase/core';
import { logger } from '@vobase/core';
import type { CardElement } from 'chat';
import { eq } from 'drizzle-orm';

import { getAgent } from '../../../mastra/agents';
import { channelInstances, conversations } from '../schema';
import { emitActivityEvent } from './activity-events';
import { formatConstraintsForPrompt } from './channel-constraints';
import { serializeCard } from './chat-bridge';
import { getChatState } from './chat-init';
import { getConversationsDeps } from './deps';
import { enqueueMessage } from './outbox';

/** Tools that emit activity events on execution (side-effect tools). */
const EMIT_EVENT_TOOLS = new Set([
  'book_slot',
  'cancel_booking',
  'reschedule_booking',
  'send_reminder',
  'consult_human',
  'send_card',
]);

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
/** @lintignore */
export function extractSendCardResults(response: {
  steps?: unknown[];
  toolResults?: unknown[];
}): CardElement[] {
  const cards: CardElement[] = [];

  if (!response.steps || !Array.isArray(response.steps)) {
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

export async function generateChannelReply(
  deps: ReplyDeps,
  conversationId: string,
  inboundContent?: string,
): Promise<string | null> {
  const { db, scheduler } = deps;
  const { realtime } = getConversationsDeps();

  // Load conversation
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));

  if (!conversation || conversation.status !== 'active') {
    logger.warn(
      '[conversations] Cannot generate reply for inactive conversation',
      {
        conversationId,
        status: conversation?.status,
      },
    );
    return null;
  }

  // Get agent
  const registered = getAgent(conversation.agentId);
  if (!registered) {
    logger.error('[conversations] Agent not found', {
      agentId: conversation.agentId,
    });
    return null;
  }

  // Resolve channel type early (needed for context injection and card routing)
  const [instance] = conversation.channelInstanceId
    ? await db
        .select({ type: channelInstances.type })
        .from(channelInstances)
        .where(eq(channelInstances.id, conversation.channelInstanceId))
    : [];
  const channelType = instance?.type ?? 'web';

  // Check for consultation reply in chat state
  const state = getChatState();
  const consultationReply = await state.get<{
    reply?: string;
    timeout?: boolean;
    staffId?: string;
  }>(`consultation:${conversationId}`);

  // Build the message to send to the agent
  let messageContent = inboundContent ?? '';

  if (consultationReply) {
    if (consultationReply.reply) {
      messageContent += `\n\n[Staff consultation reply]: ${consultationReply.reply}`;
    } else if (consultationReply.timeout) {
      messageContent +=
        '\n\n[System]: Staff consultation timed out. Please proceed with your best judgment or inform the customer.';
    }
    await state.delete(`consultation:${conversationId}`);
  }

  if (!messageContent) {
    return null;
  }

  // Prepend channel constraints so the agent tailors card structure per channel
  const constraintText = formatConstraintsForPrompt(channelType);
  const contextPrefix = `[Channel: ${channelType}]\n${constraintText}\n\n`;

  // Build RequestContext so sendCard tool and processors can access channel type
  const rc = new RequestContext();
  rc.set('conversationId', conversationId);
  rc.set('contactId', conversation.contactId);
  rc.set('channel', channelType);
  rc.set('agentId', conversation.agentId);

  // Generate response using agent (non-streaming for channels)
  try {
    const response = await registered.agent.generate(
      contextPrefix + messageContent,
      {
        memory: {
          thread: conversationId,
          resource: `contact:${conversation.contactId}`,
        },
        maxSteps: 5,
        requestContext: rc,
        onStepFinish: async (step) => {
          if (!step.toolResults || !Array.isArray(step.toolResults)) return;
          for (const tr of step.toolResults as unknown[]) {
            const result = tr as Record<string, unknown>;
            const payload = (result.payload ?? result) as Record<
              string,
              unknown
            >;
            const toolName = payload.toolName as string | undefined;
            if (toolName && EMIT_EVENT_TOOLS.has(toolName)) {
              await emitActivityEvent(db, realtime, {
                type: 'agent.tool_executed',
                agentId: conversation.agentId,
                source: 'agent',
                contactId: conversation.contactId,
                conversationId,
                channelRoutingId: conversation.channelRoutingId,
                channelType,
                data: {
                  toolName,
                  isError: (payload.isError as boolean) ?? false,
                },
              });
            }
          }
        },
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
      await enqueueMessage(
        db,
        scheduler,
        {
          conversationId,
          content: serialized.content,
          channelType,
          channelInstanceId: conversation.channelInstanceId,
          payload: serialized.payload,
        },
        realtime,
      );
    }

    // Also enqueue any text response (agent may combine text + cards)
    const responseText =
      typeof response.text === 'string'
        ? response.text
        : String(response.text ?? '');

    if (responseText) {
      await enqueueMessage(
        db,
        scheduler,
        {
          conversationId,
          content: responseText,
          channelType,
          channelInstanceId: conversation.channelInstanceId,
        },
        realtime,
      );
    }

    // Post-generation: check if agent called complete_conversation
    // Re-read conversation metadata in case complete_conversation tool modified it during generation
    const [updatedConversation] = await db
      .select({ metadata: conversations.metadata })
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    const updatedMeta = (
      updatedConversation?.metadata &&
      typeof updatedConversation.metadata === 'object'
        ? updatedConversation.metadata
        : {}
    ) as Record<string, unknown>;

    if (updatedMeta.completing) {
      const { completeConversation: doComplete } = await import(
        './conversation'
      );

      // Check if conversation had any consultations
      const { consultations: consultationsTable } = await import('../schema');
      const [hasConsultation] = await db
        .select({ id: consultationsTable.id })
        .from(consultationsTable)
        .where(eq(consultationsTable.conversationId, conversationId))
        .limit(1);

      const outcome = hasConsultation ? 'escalated_resolved' : 'resolved';
      await doComplete(db, conversationId, realtime, outcome);
    }

    return responseText || null;
  } catch (err) {
    logger.error('[conversations] Agent generation failed', {
      conversationId,
      agentId: conversation.agentId,
      error: err,
    });

    // Enqueue a fallback message so the customer is not left without a response
    await enqueueMessage(db, scheduler, {
      conversationId,
      content:
        "We're experiencing a temporary issue. Please try again shortly.",
      channelType,
      channelInstanceId: conversation.channelInstanceId,
    });

    return null;
  }
}
