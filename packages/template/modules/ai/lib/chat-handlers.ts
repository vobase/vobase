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
import { handleStaffReply } from './consult-human';
import { createConversation } from './conversation';
import { enqueueDelivery } from './delivery';
import { insertMessage } from './messages';
import { findContactByAddress, findOrCreateContact } from './routing';
import { transition } from './state-machine';

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
        await routeByMode(
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
      await routeByMode(
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
      // Load conversation to check mode
      const [conversation] = await db
        .select({
          id: conversations.id,
          mode: conversations.mode,
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

      await routeByMode(
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

async function routeByMode(
  deps: { db: VobaseDb; scheduler: Scheduler; realtime: RealtimeService },
  conversation: {
    id: string;
    mode: string | null;
    contactId: string;
    channelInstanceId: string;
  },
  messageText: string | undefined,
  contactId: string,
): Promise<void> {
  const { db, scheduler, realtime } = deps;
  const mode = conversation.mode ?? 'ai';

  // Delegate all state mutations to the machine:
  // - unreadCount increment (human/supervised/held only)
  // - activity event emission (message.inbound or message.inbound_human_mode)
  // - lastSignal update
  // - realtime.notify with actual hasPendingEscalation (fixes hardcoded false bug)
  await transition({ db, realtime }, conversation.id, {
    type: 'INBOUND_MESSAGE',
    contactId,
    content: messageText,
  });

  if (mode === 'human') {
    // Human mode — state handled by machine above, nothing else to do
    return;
  }

  if (mode === 'held') {
    // Auto-acknowledge, do NOT generate AI response
    const msg = await insertMessage(db, realtime, {
      conversationId: conversation.id,
      messageType: 'outgoing',
      contentType: 'text',
      content:
        'Your message has been received. We will get back to you shortly.',
      status: 'queued',
      senderId: 'system',
      senderType: 'system',
      channelType: 'web',
    });
    await enqueueDelivery(scheduler, msg.id);
    return;
  }

  // 'ai' or 'supervised' — schedule channel-reply job
  await scheduler.add('ai:channel-reply', {
    conversationId: conversation.id,
    inboundContent: messageText,
  });
}
