/**
 * Chat-sdk handler registration — replaces hand-rolled routing pipeline.
 *
 * Registers onDirectMessage, onSubscribedMessage, and onAction handlers
 * on the Chat instance. These handlers replace routeInboundMessage().
 */
import type { ChannelsService, Scheduler, VobaseDb } from '@vobase/core';
import { logger } from '@vobase/core';
import type { Chat } from 'chat';
import { and, eq } from 'drizzle-orm';

import { consultations, endpoints } from '../schema';
import { handleStaffReply } from './consult-human';
import { findContactByAddress, findOrCreateContact } from './routing';
import { createSession } from './session';

interface HandlerDeps {
  db: VobaseDb;
  scheduler: Scheduler;
  channels: ChannelsService;
}

/** Register all chat-sdk handlers on the Chat instance. */
export function registerHandlers(chat: Chat, deps: HandlerDeps): void {
  const { db, scheduler, channels } = deps;

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
            { db, scheduler, channels },
            pendingConsultation,
            syntheticEvent,
          );
          return;
        }
      }

      // 2. New session creation — find endpoint by channel instance
      const [endpoint] = await db
        .select()
        .from(endpoints)
        .where(
          and(
            eq(endpoints.channelInstanceId, channelInstanceId),
            eq(endpoints.enabled, true),
          ),
        );

      if (!endpoint) {
        logger.warn(
          '[conversations] No enabled endpoint for channel instance',
          {
            channelInstanceId,
            from: message.author.userId,
          },
        );
        return;
      }

      // Resolve or create contact
      const contact =
        staffContact ?? (await findOrCreateContact(db, syntheticEvent));

      // Create session (subscribes in state + creates Mastra Memory thread)
      const session = await createSession(
        { db, scheduler },
        {
          endpointId: endpoint.id,
          contactId: contact.id,
          agentId: endpoint.agentId,
          channelInstanceId,
        },
      );

      // Queue AI reply generation
      await scheduler.add('conversations:channel-reply', {
        sessionId: session.id,
        inboundContent: message.text,
      });
    } catch (err) {
      logger.error('[conversations] Direct message handler failed', {
        threadId: thread.id,
        error: err,
      });
    }
  });

  // ─── Subscribed messages (existing sessions) ───────────────────

  chat.onSubscribedMessage(async (thread, message) => {
    try {
      // Resume existing session — dispatch to agent
      await scheduler.add('conversations:channel-reply', {
        sessionId: thread.id,
        inboundContent: message.text,
      });
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

      // Route to session — the action data determines what happens
      await scheduler.add('conversations:channel-reply', {
        sessionId: event.threadId,
        inboundContent: `[Action: ${JSON.stringify(data)}]`,
      });
    } catch (err) {
      logger.error('[conversations] Action handler failed', { error: err });
    }
  });
}
