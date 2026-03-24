import type {
  ChannelsService,
  MessageReceivedEvent,
  Scheduler,
  StatusUpdateEvent,
  StorageService,
  VobaseDb,
} from '@vobase/core';
import { logger } from '@vobase/core';
import { and, eq, sql } from 'drizzle-orm';

import { getAgentForChannel, getDefaultAgent } from '../../../mastra/agents';
import {
  msgContactInboxes,
  msgConversations,
  msgInboxes,
  msgOutbox,
} from '../schema';
import { findOrCreateContact } from './contacts';
import { findOrCreateConversation } from './conversations';
import { saveInboundMessage } from './memory-bridge';

interface ChannelHandlerDeps {
  db: VobaseDb;
  scheduler: Scheduler;
  channels: ChannelsService;
  storage: StorageService;
}

/**
 * Get the next 9am timestamp (tomorrow if past 9am today).
 */
function nextNineAm(): Date {
  const now = new Date();
  const next = new Date(now);
  next.setHours(9, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * Resolve the inbox for an inbound message.
 * First tries to match channelConfig->>'phoneNumber' if a recipient phone is provided,
 * then falls back to matching by channel type.
 */
async function resolveInbox(
  db: VobaseDb,
  channel: string,
  recipientPhone?: string,
) {
  // Try exact phone match first (e.g. WhatsApp business number)
  if (recipientPhone) {
    const byPhone = await db
      .select()
      .from(msgInboxes)
      .where(
        and(
          sql`${msgInboxes.channelConfig}->>'phoneNumber' = ${recipientPhone}`,
          eq(msgInboxes.enabled, true),
        ),
      );
    if (byPhone[0]) return byPhone[0];
  }

  // Fallback: first enabled inbox for this channel
  const byChannel = await db
    .select()
    .from(msgInboxes)
    .where(and(eq(msgInboxes.channel, channel), eq(msgInboxes.enabled, true)))
    .limit(1);
  return byChannel[0] ?? null;
}

/**
 * Find or create a contact-inbox association.
 * Links a contact to an inbox via their external source identifier.
 */
async function findOrCreateContactInbox(
  db: VobaseDb,
  contactId: string,
  inboxId: string,
  sourceId: string,
) {
  const existing = await db
    .select()
    .from(msgContactInboxes)
    .where(
      and(
        eq(msgContactInboxes.inboxId, inboxId),
        eq(msgContactInboxes.sourceId, sourceId),
      ),
    );
  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(msgContactInboxes)
    .values({ contactId, inboxId, sourceId })
    .returning();
  return created;
}

/**
 * Handle inbound messages from external channels.
 * Flow: findOrCreateContact -> findOrCreateConversation -> store message in Memory -> AI reply (if handler=ai)
 */
export async function handleInboundMessage(
  deps: ChannelHandlerDeps,
  event: MessageReceivedEvent,
) {
  const { db, scheduler } = deps;

  // 1. Find or create contact
  const contact = await findOrCreateContact(db, event.from, event.profileName);

  // 2. Try to resolve inbox from channel config or channel type
  const recipientPhone = event.metadata?.phoneNumber as string | undefined;
  const inbox = await resolveInbox(db, event.channel, recipientPhone);

  // 3. Determine agent: prefer inbox default, fallback to channel registry
  let agentId: string | undefined;
  if (inbox?.defaultAgentId) {
    agentId = inbox.defaultAgentId;
  } else {
    const channelAgent = getAgentForChannel(event.channel);
    agentId = channelAgent?.meta.id ?? getDefaultAgent()?.meta.id;
  }
  if (!agentId) return; // No agents configured

  // 4. If inbox found, create contactInbox association
  if (inbox) {
    await findOrCreateContactInbox(db, contact.id, inbox.id, event.from);
  }

  // 5. Find or create conversation (inbox-aware)
  const conversation = await findOrCreateConversation(
    db,
    contact.id,
    event.channel,
    agentId,
    inbox?.id,
  );

  // 6. Reopen resolved/closed conversations on new inbound message
  if (conversation.status === 'resolved' || conversation.status === 'closed') {
    await db
      .update(msgConversations)
      .set({
        status: 'open',
        handler: 'ai',
        resolvedAt: null,
      })
      .where(eq(msgConversations.id, conversation.id));
    // Reflect updated status locally for downstream logic
    conversation.status = 'open';
    conversation.handler = 'ai';
  }

  // 7. Upload media attachments (WhatsApp URLs expire in ~5 min)
  logger.info('Inbound message received', {
    conversationId: conversation.id,
    channel: event.channel,
    hasMedia: !!event.media?.length,
    mediaCount: event.media?.length ?? 0,
    messageType: event.messageType,
    contentLength: event.content?.length ?? 0,
  });

  interface Attachment {
    storageKey: string;
    type: string;
    mimeType: string;
    filename?: string;
    size: number;
  }
  const attachments: Attachment[] = [];

  if (event.media?.length) {
    const bucket = deps.storage.bucket('chat-attachments');
    for (const media of event.media) {
      const ext = media.mimeType.split('/')[1]?.split(';')[0] ?? 'bin';
      const key = `${conversation.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      try {
        const obj = await bucket.upload(key, media.data, {
          contentType: media.mimeType,
        });
        attachments.push({
          storageKey: key,
          type: media.type,
          mimeType: media.mimeType,
          filename: media.filename,
          size: obj.size,
        });
      } catch (err) {
        logger.error('Failed to upload media attachment', {
          conversationId: conversation.id,
          error: err,
        });
      }
    }
  }

  // Build content with media context for the AI
  let content = event.content || '';
  if (attachments.length && !content) {
    const descriptions = attachments.map((a) => {
      if (a.filename) return `[${a.type}: ${a.filename}]`;
      return `[${a.type}]`;
    });
    content = descriptions.join(' ');
  }

  // 8. Store inbound message in Mastra Memory
  const resourceId =
    conversation.userId ?? conversation.contactId ?? contact.id;
  try {
    await saveInboundMessage({
      threadId: conversation.id,
      resourceId,
      content,
    });
  } catch (err) {
    logger.warn('Failed to save inbound message to Memory', {
      conversationId: conversation.id,
      error: err,
    });
  }

  // 9. Update window expiry (24h from now)
  await db
    .update(msgConversations)
    .set({ windowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .where(eq(msgConversations.id, conversation.id));

  // 10. If conversation handler is 'ai', queue a debounced reply
  // Delay 3s so rapid-fire messages are batched into one AI response
  if (conversation.handler === 'ai') {
    await scheduler.add(
      'messaging:channel-reply',
      { conversationId: conversation.id, triggeredAt: Date.now() },
      { startAfter: 3 },
    );
  }
}

/**
 * Handle status updates from external channels.
 * Updates msgOutbox.status, detects staff-sent messages.
 */
export async function handleStatusUpdate(
  deps: ChannelHandlerDeps,
  event: StatusUpdateEvent,
) {
  const { db } = deps;

  // Update message status by externalMessageId in the outbox
  const existing = (
    await db
      .select()
      .from(msgOutbox)
      .where(eq(msgOutbox.externalMessageId, event.messageId))
  )[0];

  if (existing) {
    // Known outbound message — update status only if it's a forward progression
    const STATUS_ORDER: Record<string, number> = {
      queued: 0,
      sent: 1,
      delivered: 2,
      read: 3,
      failed: -1,
    };

    const currentLevel = STATUS_ORDER[existing.status ?? 'queued'] ?? 0;
    const newLevel = STATUS_ORDER[event.status] ?? 0;

    const shouldUpdate =
      newLevel > currentLevel ||
      (event.status === 'failed' && currentLevel <= 1) ||
      (existing.status === 'failed' && newLevel > 0);

    if (shouldUpdate) {
      logger.info('Message status update', {
        messageId: existing.id,
        from: existing.status,
        to: event.status,
        externalId: event.messageId,
      });
      await db
        .update(msgOutbox)
        .set({ status: event.status })
        .where(eq(msgOutbox.id, existing.id));
    } else {
      logger.info('Message status update skipped (not a forward progression)', {
        messageId: existing.id,
        current: existing.status,
        incoming: event.status,
        externalId: event.messageId,
      });
    }
    return;
  }

  // Staff-sent detection: no outbound row for this externalMessageId
  if (event.status === 'sent' || event.status === 'delivered') {
    // Staff detection handled when the actual message arrives via message_received
  }
}

/**
 * Detect and handle staff-sent messages.
 * Saves to Memory and pauses AI.
 */
export async function handleStaffSent(
  db: VobaseDb,
  conversationId: string,
  content: string,
  _externalMessageId: string,
) {
  // Store as staff message in Memory
  try {
    await saveInboundMessage({
      threadId: conversationId,
      resourceId: conversationId, // staff messages use conversationId as resourceId
      content,
      role: 'user',
    });
  } catch {
    // Memory not available — non-fatal
  }

  // Pause AI, set resume to next 9am
  await db
    .update(msgConversations)
    .set({
      status: 'pending',
      handler: 'human',
      aiPausedAt: new Date(),
      aiResumeAt: nextNineAm(),
    })
    .where(eq(msgConversations.id, conversationId));
}
