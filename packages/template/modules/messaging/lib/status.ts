import type { ReactionEvent, StatusUpdateEvent } from '@vobase/core';
import { logger, shouldUpdateStatus } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { messages } from '../schema';
import { getModuleDeps } from './deps';
import { insertMessage } from './messages';

export async function handleStatusUpdate(
  event: StatusUpdateEvent,
): Promise<void> {
  const { db, realtime } = getModuleDeps();

  const [message] = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      status: messages.status,
    })
    .from(messages)
    .where(eq(messages.externalMessageId, event.messageId));

  if (!message) {
    logger.warn('[messaging] status_update: message not found', {
      externalMessageId: event.messageId,
      status: event.status,
    });
    return;
  }

  // Only advance status — never go backwards (failed is always accepted)
  if (!shouldUpdateStatus(message.status, event.status)) {
    logger.info('[messaging] status_update: skipping out-of-order update', {
      externalMessageId: event.messageId,
      current: message.status,
      incoming: event.status,
    });
    return;
  }

  await db
    .update(messages)
    .set({ status: event.status })
    .where(eq(messages.id, message.id));

  // Insert system activity if the message was deleted on the sender's device
  if (event.metadata?.deleted === true) {
    await insertMessage(db, realtime, {
      conversationId: message.conversationId,
      messageType: 'activity',
      contentType: 'system',
      content: 'Message was deleted',
      contentData: {
        eventType: 'message_deleted',
        externalMessageId: event.messageId,
      },
      senderId: 'system',
      senderType: 'system',
    }).catch(() => {});
  }

  // Log delivery errors reported alongside the status update
  if (event.metadata?.errors) {
    logger.warn('[messaging] status_update: delivery errors reported', {
      externalMessageId: event.messageId,
      messageId: message.id,
      errors: event.metadata.errors,
    });
  }

  await realtime
    .notify({
      table: 'conversations-messages',
      id: message.conversationId,
      action: 'update',
    })
    .catch(() => {});

  logger.info('[messaging] status_update', {
    messageId: message.id,
    externalMessageId: event.messageId,
    status: event.status,
  });
}

export async function handleReaction(event: ReactionEvent): Promise<void> {
  const { db, realtime } = getModuleDeps();

  const [message] = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      contentData: messages.contentData,
    })
    .from(messages)
    .where(eq(messages.externalMessageId, event.messageId));

  if (!message) {
    logger.warn('[messaging] reaction: message not found', {
      externalMessageId: event.messageId,
    });
    return;
  }

  const currentData = (message.contentData ?? {}) as Record<string, unknown>;
  const existing = (currentData.reactions ?? []) as Array<
    Record<string, unknown>
  >;

  // Dedup by from — remove any prior reaction from this sender, then re-add unless removing
  const filtered = existing.filter((r) => r.from !== event.from);
  const updatedReactions =
    event.action === 'remove'
      ? filtered
      : [
          ...filtered,
          {
            from: event.from,
            emoji: event.emoji,
            action: event.action ?? 'add',
            timestamp: event.timestamp,
          },
        ];

  await db
    .update(messages)
    .set({ contentData: { ...currentData, reactions: updatedReactions } })
    .where(eq(messages.id, message.id));

  await realtime
    .notify({
      table: 'conversations-messages',
      id: message.conversationId,
      action: 'update',
    })
    .catch(() => {});

  logger.info('[messaging] reaction', {
    messageId: message.id,
    from: event.from,
    emoji: event.emoji,
    action: event.action,
  });
}
