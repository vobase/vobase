import type {
  ChannelsService,
  RealtimeService,
  Scheduler,
  VobaseDb,
} from '@vobase/core';
import { logger } from '@vobase/core';
import type { Chat } from 'chat';
import { and, eq } from 'drizzle-orm';

import { channelRoutings, consultations, conversations } from '../schema';
import { emitActivityEvent } from './activity-events';
import { handleStaffReply } from './consult-human';
import { createConversation } from './conversation';
import { enqueueMessage } from './outbox';
import { findContactByAddress, findOrCreateContact } from './routing';

interface HandlerDeps {
  db: VobaseDb;
  scheduler: Scheduler;
  channels: ChannelsService;
  realtime: RealtimeService;
}

export function registerHandlers(chat: Chat, deps: HandlerDeps): void {
  const { db, scheduler, channels, realtime } = deps;

  // ─── Direct messages (new conversations) ───────────────────────

  chat.onDirectMessage(async (thread, message) => {
    try {
      const channelInstanceId = thread.adapter.name;

      // Build a synthetic event for routing utilities (findContactByAddress, findOrCreateContact)
      const syntheticEvent = {
        type: 'message_received' as const,
        channel: channelInstanceId, // Legacy field — adapter name is instance ID
        from: message.author.userId,
        profileName: message.author.fullName,
        messageId: message.id,
        content: message.text,
        messageType: 'text' as const,
        timestamp: message.metadata.dateSent.getTime(),
      };

      // 1. Staff reply intercept — check if sender is staff with pending consultation
      const staffContact = await findContactByAddress(db, syntheticEvent);
      if (staffContact && staffContact.role === 'staff') {
        const [pendingConsultation] = await db
          .select()
          .from(consultations)
          .where(
            and(
              eq(consultations.staffContactId, staffContact.id),
              eq(consultations.status, 'pending'),
            ),
          );

        if (pendingConsultation) {
          await handleStaffReply(
            { db, scheduler, channels, realtime },
            pendingConsultation,
            syntheticEvent,
          );
          return;
        }
      }

      // Resolve or create contact (moved earlier for dedup check)
      const contact =
        staffContact ?? (await findOrCreateContact(db, syntheticEvent));

      // 2. Conversation dedup — check for existing active conversation (handler-mode-aware)
      const [existingConversation] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.contactId, contact.id),
            eq(conversations.channelInstanceId, channelInstanceId),
            eq(conversations.status, 'active'),
          ),
        );

      if (existingConversation) {
        await routeByHandlerMode(
          { db, scheduler, realtime },
          existingConversation,
          message.text,
          contact.id,
        );
        return;
      }

      // 3. New conversation creation — find channelRouting by channel instance
      const [channelRouting] = await db
        .select()
        .from(channelRoutings)
        .where(
          and(
            eq(channelRoutings.channelInstanceId, channelInstanceId),
            eq(channelRoutings.enabled, true),
          ),
        );

      if (!channelRouting) {
        logger.warn(
          '[conversations] No enabled channelRouting for channel instance',
          {
            channelInstanceId,
            from: message.author.userId,
          },
        );
        return;
      }

      // Create conversation (subscribes in state + creates Mastra Memory thread)
      const conversation = await createConversation(
        { db, scheduler, realtime },
        {
          channelRoutingId: channelRouting.id,
          contactId: contact.id,
          agentId: channelRouting.agentId,
          channelInstanceId,
        },
      );

      // Route by handler mode (new conversations default to 'ai')
      await routeByHandlerMode(
        { db, scheduler, realtime },
        conversation,
        message.text,
        contact.id,
      );
    } catch (err) {
      logger.error('[conversations] Direct message handler failed', {
        threadId: thread.id,
        error: err,
      });
    }
  });

  // ─── Subscribed messages (existing conversations) ──────────────

  chat.onSubscribedMessage(async (thread, message) => {
    try {
      // Load conversation to check handler mode
      const [conversation] = await db
        .select({
          id: conversations.id,
          handler: conversations.handler,
          contactId: conversations.contactId,
          channelInstanceId: conversations.channelInstanceId,
        })
        .from(conversations)
        .where(eq(conversations.id, thread.id));

      if (!conversation) {
        logger.warn(
          '[conversations] Conversation not found for subscribed message',
          {
            threadId: thread.id,
          },
        );
        return;
      }

      await routeByHandlerMode(
        { db, scheduler, realtime },
        conversation as typeof conversations.$inferSelect,
        message.text,
        conversation.contactId,
      );
    } catch (err) {
      logger.error('[conversations] Subscribed message handler failed', {
        threadId: thread.id,
        error: err,
      });
    }
  });

  // ─── Action button replies ─────────────────────────────────────

  chat.onAction(async (event) => {
    try {
      // Decode button callback data from WhatsApp interactive reply
      const actionId = event.actionId;
      if (!actionId?.startsWith('chat:')) return;

      const data = JSON.parse(actionId.slice(5));
      logger.info('[conversations] Action received', {
        threadId: event.threadId,
        data,
      });

      // Route to conversation — the action data determines what happens
      await scheduler.add('ai:channel-reply', {
        conversationId: event.threadId,
        inboundContent: `[Action: ${JSON.stringify(data)}]`,
      });
    } catch (err) {
      logger.error('[conversations] Action handler failed', { error: err });
    }
  });
}

async function routeByHandlerMode(
  deps: { db: VobaseDb; scheduler: Scheduler; realtime: RealtimeService },
  conversation: {
    id: string;
    handler: string | null;
    contactId: string;
    channelInstanceId: string;
  },
  messageText: string | undefined,
  contactId: string,
): Promise<void> {
  const { db, scheduler, realtime } = deps;
  const handlerMode = conversation.handler ?? 'ai';

  if (handlerMode === 'human') {
    // Forward to assigned staff — emit activity event, do NOT schedule AI
    await emitActivityEvent(db, realtime, {
      type: 'message.inbound_human_mode',
      source: 'system',
      conversationId: conversation.id,
      contactId,
      data: { content: messageText?.slice(0, 200) },
    });
    return;
  }

  if (handlerMode === 'paused') {
    // Auto-acknowledge, do NOT generate AI response
    await enqueueMessage(
      db,
      scheduler,
      {
        conversationId: conversation.id,
        content:
          'Your message has been received. We will get back to you shortly.',
        channelType: 'web', // Best-effort default; processOutboxMessage resolves actual type at send time
        channelInstanceId: conversation.channelInstanceId,
      },
      realtime,
    );
    return;
  }

  // 'ai' or 'supervised' — schedule channel-reply job
  await scheduler.add('ai:channel-reply', {
    conversationId: conversation.id,
    inboundContent: messageText,
  });
}
