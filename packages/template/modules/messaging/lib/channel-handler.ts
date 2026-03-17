import type {
  ChannelsService,
  MessageReceivedEvent,
  Scheduler,
  StatusUpdateEvent,
  StorageService,
  VobaseDb,
} from '@vobase/core';
import { logger } from '@vobase/core';
import { and, eq } from 'drizzle-orm';

import { msgAgents, msgMessages, msgThreads } from '../schema';
import { findOrCreateContact } from './contacts';
import { findOrCreateThread } from './threads';

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
 * Handle inbound messages from external channels.
 * Flow: findOrCreateContact -> findOrCreateThread -> store message -> AI reply (if status=ai)
 */
export async function handleInboundMessage(
  deps: ChannelHandlerDeps,
  event: MessageReceivedEvent,
) {
  const { db, scheduler } = deps;

  // 1. Find or create contact
  const contact = await findOrCreateContact(db, event.from, event.profileName);

  // 2. Find default agent for this channel
  const agents = await db.select().from(msgAgents).all();
  const channelAgent = agents.find((a) => {
    const channels: string[] = a.channels ? JSON.parse(a.channels) : [];
    return channels.includes(event.channel);
  });
  const agentId = channelAgent?.id ?? agents[0]?.id;
  if (!agentId) return; // No agents configured

  // 3. Find or create thread
  const thread = await findOrCreateThread(
    db,
    contact.id,
    event.channel,
    agentId,
  );

  // 4. Upload media attachments (WhatsApp URLs expire in ~5 min)
  logger.info('Inbound message received', {
    threadId: thread.id,
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
      const key = `${thread.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
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
          threadId: thread.id,
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

  // 5. Store inbound message
  await db.insert(msgMessages).values({
    threadId: thread.id,
    direction: 'inbound',
    senderType: 'contact',
    aiRole: 'user',
    content,
    externalMessageId: event.messageId,
    status: 'delivered',
    attachments: attachments.length ? JSON.stringify(attachments) : null,
  });

  // 6. Update window expiry (24h from now)
  await db
    .update(msgThreads)
    .set({ windowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
    .where(eq(msgThreads.id, thread.id));

  // 7. If thread status is 'ai', queue a debounced reply
  // Delay 3s so rapid-fire messages are batched into one AI response
  if (thread.status === 'ai') {
    await scheduler.add(
      'messaging:channel-reply',
      { threadId: thread.id, triggeredAt: Date.now() },
      { delay: '3s' },
    );
  }
}

/**
 * Handle status updates from external channels.
 * Updates msg_messages.status, detects staff-sent messages.
 */
export async function handleStatusUpdate(
  deps: ChannelHandlerDeps,
  event: StatusUpdateEvent,
) {
  const { db } = deps;

  // Update message status by externalMessageId
  const existing = (
    await db
      .select()
      .from(msgMessages)
      .where(
        and(
          eq(msgMessages.externalMessageId, event.messageId),
          eq(msgMessages.direction, 'outbound'),
        ),
      )
  )[0];

  if (existing) {
    // Known outbound message — update status only if it's a forward progression
    // Status hierarchy: queued < sent < delivered < read. 'failed' is special.
    const STATUS_ORDER: Record<string, number> = {
      queued: 0,
      sent: 1,
      delivered: 2,
      read: 3,
      failed: -1, // failed can only overwrite queued/sent, not delivered/read
    };

    const currentLevel = STATUS_ORDER[existing.status ?? 'queued'] ?? 0;
    const newLevel = STATUS_ORDER[event.status] ?? 0;

    // Allow forward progression, or failed→sent recovery
    const shouldUpdate =
      newLevel > currentLevel ||
      (event.status === 'failed' && currentLevel <= 1) || // failed only overwrites queued/sent
      (existing.status === 'failed' && newLevel > 0); // recovery from failed

    if (shouldUpdate) {
      logger.info('Message status update', {
        messageId: existing.id,
        from: existing.status,
        to: event.status,
        externalId: event.messageId,
      });
      await db
        .update(msgMessages)
        .set({ status: event.status })
        .where(eq(msgMessages.id, existing.id));
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
  // This means someone replied from the WhatsApp Business app directly
  // Find the thread by looking for any message with this external ID pattern
  // For staff-sent, the status update arrives for a message we didn't send
  // We need to find the thread via the channel
  if (event.status === 'sent' || event.status === 'delivered') {
    // Look for threads on this channel that might have staff activity
    // Staff detection uses the fact that we have no outbound record for this messageId
    // We can't reliably map back to a thread from just a status update for a staff message
    // This is handled when the actual message arrives via message_received
  }
}

/**
 * Detect and handle staff-sent messages.
 * Called when a message_received event has no matching outbound externalMessageId,
 * indicating it was sent by staff directly on the platform.
 */
export async function handleStaffSent(
  db: VobaseDb,
  threadId: string,
  content: string,
  externalMessageId: string,
) {
  // Store as staff message
  await db.insert(msgMessages).values({
    threadId,
    direction: 'inbound',
    senderType: 'staff',
    aiRole: 'user',
    content,
    externalMessageId,
    status: 'delivered',
  });

  // Pause AI, set resume to next 9am
  await db
    .update(msgThreads)
    .set({
      status: 'human',
      aiPausedAt: new Date(),
      aiResumeAt: nextNineAm(),
    })
    .where(eq(msgThreads.id, threadId));
}
