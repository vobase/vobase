import { RequestContext } from '@mastra/core/request-context';
import type { ChannelsService, Scheduler, VobaseDb } from '@vobase/core';
import { logger } from '@vobase/core';
import { and, desc, eq, gt, sql } from 'drizzle-orm';

import { getAgent } from '../../../mastra/agents';
import { isAgentAssignee } from './assignee';
import {
  channelInstances,
  channelSessions,
  conversations,
  messages,
} from '../schema';
import type { CardElement } from './card-serialization';
import { serializeCard } from './card-serialization';
import { formatConstraintsForPrompt } from './channel-constraints';
import { enqueueDelivery } from './delivery';
import { getModuleDeps } from './deps';
import { createActivityMessage, insertMessage } from './messages';
import { transition } from './state-machine';

/** Tools that emit activity events on execution (side-effect tools). */
const EMIT_EVENT_TOOLS = new Set([
  'book_slot',
  'cancel_booking',
  'reschedule_booking',
  'send_reminder',
  'mention',
  'reassign',
  'hold',
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
): Promise<string | null> {
  const { db, scheduler } = deps;
  const { realtime } = getModuleDeps();

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

  // Load last outgoing message timestamp (used to filter unprocessed inbound + mention notes)
  const [lastOutgoing] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.messageType, 'outgoing'),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  // Batch read: collect all unprocessed inbound messages since the last outgoing message
  const inboundFilter = and(
    eq(messages.conversationId, conversationId),
    eq(messages.messageType, 'incoming'),
    eq(messages.senderType, 'contact'),
    ...(lastOutgoing ? [gt(messages.createdAt, lastOutgoing.createdAt)] : []),
  );

  const unprocessedMessages = await db
    .select({ content: messages.content, createdAt: messages.createdAt })
    .from(messages)
    .where(inboundFilter)
    .orderBy(messages.createdAt);

  const inboundContent = unprocessedMessages
    .map((m) => m.content)
    .filter(Boolean)
    .join('\n');

  // Build the message to send to the agent
  let messageContent = inboundContent;

  // Inject @mention-based staff notes since last outgoing message
  const mentionNotes = await db
    .select({ content: messages.content, senderId: messages.senderId })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.messageType, 'activity'),
        sql`mentions @> ${JSON.stringify([{ targetId: conversation.agentId, targetType: 'agent' }])}::jsonb`,
        ...(lastOutgoing
          ? [gt(messages.createdAt, lastOutgoing.createdAt)]
          : []),
      ),
    )
    .orderBy(messages.createdAt);

  for (const note of mentionNotes) {
    messageContent += `\n\n[Staff note from ${note.senderId}]: ${note.content}`;
  }

  if (!messageContent) {
    return null;
  }

  // Load channel session context (messaging window status)
  let sessionContext = '';
  const adapter = deps.channels.getAdapter(channelType);
  if (adapter?.getSessionContext) {
    const [session] = await db
      .select({
        windowExpiresAt: channelSessions.windowExpiresAt,
        sessionState: channelSessions.sessionState,
      })
      .from(channelSessions)
      .where(eq(channelSessions.conversationId, conversationId))
      .limit(1);

    if (session) {
      const ctx = adapter.getSessionContext({
        windowExpiresAt: session.windowExpiresAt,
        sessionState: session.sessionState,
      });
      if (ctx) sessionContext = `\n${ctx}`;
    }
  }

  // Prepend channel constraints so the agent tailors card structure per channel
  const constraintText = formatConstraintsForPrompt(channelType);
  let contextPrefix = `[Channel: ${channelType}]${sessionContext}\n${constraintText}\n\n`;

  // Inject reopenCount into agent context if > 0
  if (conversation.reopenCount > 0) {
    contextPrefix += `[System]: This conversation was reopened ${conversation.reopenCount} time(s). The contact is returning to a previously resolved topic.\n\n`;
  }

  // Build RequestContext so sendCard tool and processors can access channel type
  const rc = new RequestContext();
  rc.set('conversationId', conversationId);
  rc.set('contactId', conversation.contactId);
  rc.set('channel', channelType);
  rc.set('agentId', conversation.agentId);
  rc.set('deps', getModuleDeps());

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
              await createActivityMessage(db, realtime, {
                conversationId: conversationId,
                eventType: 'agent.tool_executed',
                actor: conversation.agentId,
                actorType: 'agent',
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
      const cardMsg = await insertMessage(db, realtime, {
        conversationId,
        messageType: 'outgoing',
        contentType: 'interactive',
        content: serialized.content,
        contentData: serialized.payload ?? {},
        status: 'queued',
        senderId: conversation.agentId,
        senderType: 'agent',
        channelType,
      });
      await enqueueDelivery(scheduler, cardMsg.id);
    }

    // Also enqueue any text response — but skip if cards already cover the content
    const responseText =
      typeof response.text === 'string'
        ? response.text
        : String(response.text ?? '');

    if (responseText && cardElements.length === 0) {
      const textMsg = await insertMessage(db, realtime, {
        conversationId,
        messageType: 'outgoing',
        contentType: 'text',
        content: responseText,
        status: 'queued',
        senderId: conversation.agentId,
        senderType: 'agent',
        channelType,
      });
      await enqueueDelivery(scheduler, textMsg.id);
    }

    // Post-generation: check if conversation is in 'resolving' status
    // (set by resolve_conversation tool via SET_RESOLVING transition during generation)
    const [updatedConversation] = await db
      .select({ status: conversations.status, assignee: conversations.assignee })
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    if (updatedConversation?.status === 'resolving') {
      // Determine outcome based on current assignee: human assignee = escalated, agent = resolved
      const outcome = !isAgentAssignee(updatedConversation.assignee)
        ? 'escalated'
        : 'resolved';
      await transition({ db, realtime }, conversationId, {
        type: 'GENERATION_DONE',
        outcome,
      });
    }

    return responseText || null;
  } catch (err) {
    logger.error('[conversations] Agent generation failed', {
      conversationId,
      agentId: conversation.agentId,
      error: err,
    });

    // Enqueue a fallback message so the customer is not left without a response
    const fallbackMsg = await insertMessage(db, realtime, {
      conversationId,
      messageType: 'outgoing',
      contentType: 'text',
      content:
        "We're experiencing a temporary issue. Please try again shortly.",
      status: 'queued',
      senderId: conversation.agentId,
      senderType: 'agent',
      channelType,
    });
    await enqueueDelivery(scheduler, fallbackMsg.id);

    return null;
  }
}
