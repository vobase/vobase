/**
 * Inbound message handler — processes channel messages directly (no chat-sdk).
 *
 * Single entry point for all inbound channel messages — no chat-sdk dependency.
 * Handles staff reply intercept, contact resolution, conversation dedup,
 * reopen logic, new conversation creation, mode routing, and action button replies.
 *
 * TOCTOU note: The reopen check here is a "soft filter" (optimization to avoid
 * unnecessary REOPEN attempts). The state machine's REOPEN guard is the "hard filter"
 * (authoritative). If the idle window expires between the two checks, the state machine
 * rejects and we fall back to creating a new conversation.
 */
import type {
  ChannelsService,
  MessageReceivedEvent,
  RealtimeService,
  Scheduler,
  StorageService,
  VobaseDb,
} from '@vobase/core';
import { logger } from '@vobase/core';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';

import {
  channelInstances,
  channelRoutings,
  contacts,
  conversations,
  messages,
} from '../schema';
import { getConstraints } from './channel-constraints';
import { upsertSession } from './channel-sessions';
import {
  createConversation,
  isAgentAssignee,
  reopenConversation,
} from './conversation';
import { insertMessage } from './messages';
import { findOrCreateContact } from './routing';
import { transition } from './state-machine';

interface InboundDeps {
  db: VobaseDb;
  scheduler: Scheduler;
  channels: ChannelsService;
  realtime: RealtimeService;
  storage?: StorageService;
}

/**
 * Handle an inbound message from any channel.
 *
 * Flow:
 * 1. Staff reply intercept — check if sender is staff with pending consultation
 * 2. Contact lookup/create
 * 3. Conversation dedup — find active/resolving conversation, or reopen resolved, or create new
 * 4. Insert inbound message
 * 5. Route by mode (held → canned response, ai/supervised → agent-wake job, human → noop)
 */
export async function handleInboundMessage(
  deps: InboundDeps,
  event: MessageReceivedEvent,
): Promise<void> {
  const { db, scheduler, channels, realtime } = deps;

  try {
    const channelInstanceId = event.channelInstanceId ?? event.channel;

    // Echo: outbound message sent via WhatsApp Business app — record as staff-sent, skip inbound flow
    if (event.metadata?.echo === true) {
      await handleEchoMessage(deps, event, channelInstanceId);
      return;
    }

    // 1. Resolve or create contact
    const contact = await findOrCreateContact(db, event);

    // 3a. Check for existing active or resolving conversation
    const [existingConversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.contactId, contact.id),
          eq(conversations.channelInstanceId, channelInstanceId),
          inArray(conversations.status, ['active', 'resolving']),
        ),
      );

    if (existingConversation) {
      await appendAndRoute(
        deps,
        existingConversation,
        event,
        contact.id,
        channelInstanceId,
      );
      return;
    }

    // 3b. Check for reopenable conversation: resolved within idle window
    const channelInfo = await resolveChannelAdapter(
      db,
      channels,
      channelInstanceId,
    );
    const channelType = channelInfo?.type ?? 'web';
    const { idleWindowMs } = getConstraints(channelType);
    const idleThreshold = new Date(Date.now() - idleWindowMs);

    const [reopenable] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.contactId, contact.id),
          eq(conversations.channelInstanceId, channelInstanceId),
          eq(conversations.status, 'resolved'),
          gt(conversations.resolvedAt, idleThreshold),
        ),
      )
      .orderBy(desc(conversations.resolvedAt))
      .limit(1);

    if (reopenable) {
      // Soft filter passed — attempt reopen via state machine (hard filter)
      const reopenResult = await reopenConversation(
        { db, realtime },
        reopenable.id,
        idleWindowMs,
      );

      if (reopenResult.ok) {
        // Re-read the conversation after reopen to get updated state
        const [reopened] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, reopenable.id));

        if (reopened) {
          await appendAndRoute(
            deps,
            reopened,
            event,
            contact.id,
            channelInstanceId,
          );
          return;
        }
      }
      // If reopen rejected (idle window expired between soft/hard check), fall through to create new
    }

    // 4. New conversation — find channelRouting by channel instance
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
          from: event.from,
        },
      );
      return;
    }

    // Create conversation
    const conversation = await createConversation(
      { db, scheduler, realtime },
      {
        channelRoutingId: channelRouting.id,
        contactId: contact.id,
        agentId: channelRouting.agentId,
        channelInstanceId,
      },
    );

    await appendAndRoute(
      deps,
      conversation,
      event,
      contact.id,
      channelInstanceId,
    );
  } catch (err) {
    logger.error('[conversations] Inbound message handler failed', {
      from: event.from,
      channel: event.channel,
      error: err,
    });
  }
}

/**
 * Record an echoed outbound message (sent from WhatsApp Business app) as a staff outgoing message.
 * Skips normal inbound flow — no conversation creation, no routing.
 */
async function handleEchoMessage(
  deps: InboundDeps,
  event: MessageReceivedEvent,
  channelInstanceId: string,
): Promise<void> {
  const { db, realtime } = deps;

  // Dedup + contact lookup in parallel (independent queries)
  const [existingResult, contactResult] = await Promise.all([
    event.messageId
      ? db
          .select({ id: messages.id })
          .from(messages)
          .where(eq(messages.externalMessageId, event.messageId))
      : Promise.resolve([]),
    db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.phone, event.from)),
  ]);

  if (existingResult[0]) return;

  const contact = contactResult[0];
  if (!contact) {
    logger.info('[messaging] echo: contact not found, skipping', {
      from: event.from,
      channelInstanceId,
    });
    return;
  }

  // Find active or resolving conversation for this contact + channel
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.contactId, contact.id),
        eq(conversations.channelInstanceId, channelInstanceId),
        inArray(conversations.status, ['active', 'resolving']),
      ),
    );

  if (!conversation) {
    logger.info('[messaging] echo: no active conversation, skipping', {
      from: event.from,
      channelInstanceId,
    });
    return;
  }

  await insertMessage(db, realtime, {
    conversationId: conversation.id,
    messageType: 'outgoing',
    contentType: 'text',
    content: event.content ?? '',
    senderId: 'echo',
    senderType: 'user',
    externalMessageId: event.messageId ?? null,
    channelType: channelInstanceId,
    status: 'sent',
  });

  logger.info('[messaging] echo: recorded outbound', {
    conversationId: conversation.id,
    from: event.from,
    messageId: event.messageId,
  });
}

/**
 * Append an inbound message to a conversation and route by assignee.
 * Shared by existing-conversation, reopened-conversation, and new-conversation paths.
 */
async function appendAndRoute(
  deps: InboundDeps,
  conversation: {
    id: string;
    assignee: string;
    onHold: boolean;
    contactId: string;
    channelInstanceId: string;
  },
  event: MessageReceivedEvent,
  contactId: string,
  channelInstanceId: string,
): Promise<void> {
  const { db, scheduler, channels, realtime, storage } = deps;

  // Upload inbound media to storage
  const mediaResult = await uploadInboundMedia(storage, conversation.id, event);

  // Store inbound message
  if (event.content || mediaResult) {
    await insertMessage(db, realtime, {
      conversationId: conversation.id,
      messageType: 'incoming',
      contentType: mediaResult?.contentType ?? 'text',
      content: event.content || `[${mediaResult?.contentType ?? 'media'}]`,
      contentData: mediaResult ? { media: mediaResult.media } : {},
      senderId: contactId,
      senderType: 'contact',
      channelType: channelInstanceId ?? 'web',
    });
  }

  // Resolve channel info once for debounce + session upsert
  const channelInfo = await resolveChannelAdapter(
    db,
    channels,
    channelInstanceId,
  );

  // Refresh channel session window on inbound
  await upsertSessionIfWindowed(
    db,
    conversation.id,
    channelInstanceId,
    channelInfo,
  );

  await routeByAssignee(
    { db, scheduler, channels, realtime },
    conversation,
    event.content,
    contactId,
    channelInfo,
  );
}

/**
 * Handle an interactive button action reply (e.g. WhatsApp interactive buttons).
 * Decodes the button callback data and schedules an agent-wake job.
 */
export async function handleInboundAction(
  deps: { db: VobaseDb; scheduler: Scheduler; realtime: RealtimeService },
  event: { threadId: string; actionId: string },
): Promise<void> {
  try {
    const { actionId } = event;
    if (!actionId?.startsWith('chat:')) return;

    const data = JSON.parse(actionId.slice(5));
    logger.info('[conversations] Action received', {
      threadId: event.threadId,
      data,
    });

    // Store the button action as an inbound message so the agent sees which button was pressed
    const label = (data as Record<string, unknown>).label ?? actionId.slice(5);
    await insertMessage(deps.db, deps.realtime, {
      conversationId: event.threadId,
      messageType: 'incoming',
      contentType: 'interactive',
      content: `[Button: ${label}]`,
      contentData: { action: data },
      senderId: 'contact',
      senderType: 'contact',
      channelType: 'whatsapp',
    });

    await deps.scheduler.add('agents:agent-wake', {
      agentId: 'booking-agent',
      contactId: 'contact',
      conversationId: event.threadId,
      trigger: 'inbound_message',
    });
  } catch (err) {
    logger.error('[conversations] Action handler failed', { error: err });
  }
}

// ─── Debounce ───────────────────────────────────────────────────────

/** Resolve channel instance type + adapter in a single DB hit. Cached per call chain via caller. */
async function resolveChannelAdapter(
  db: VobaseDb,
  channels: ChannelsService,
  channelInstanceId: string,
): Promise<{
  type: string;
  adapter: ReturnType<ChannelsService['getAdapter']>;
} | null> {
  const [instance] = await db
    .select({ type: channelInstances.type })
    .from(channelInstances)
    .where(eq(channelInstances.id, channelInstanceId));

  if (!instance) return null;
  return {
    type: instance.type,
    adapter:
      channels.getAdapter(channelInstanceId) ??
      channels.getAdapter(instance.type),
  };
}

// ─── Assignee routing ──────────────────────────────────────────────

async function routeByAssignee(
  deps: {
    db: VobaseDb;
    scheduler: Scheduler;
    channels: ChannelsService;
    realtime: RealtimeService;
  },
  conversation: {
    id: string;
    assignee: string;
    onHold: boolean;
    contactId: string;
    channelInstanceId: string;
  },
  messageText: string | undefined,
  contactId: string,
  _channelInfo: {
    type: string;
    adapter: ReturnType<ChannelsService['getAdapter']>;
  } | null,
): Promise<void> {
  const { db, scheduler, realtime } = deps;

  // Delegate all state mutations to the machine
  await transition({ db, realtime }, conversation.id, {
    type: 'INBOUND_MESSAGE',
    contactId,
    content: messageText,
  });

  // On-hold: accept silently — no auto-reply in V1
  if (conversation.onHold) {
    return;
  }

  // Human assignee: noop — human handles the reply
  if (!isAgentAssignee(conversation.assignee)) {
    return;
  }

  // Agent assignee — schedule agent-wake job (debounce handled by wakeAgent singleton)
  const agentId = conversation.assignee.replace('agent:', '');
  await scheduler.add(
    'agents:agent-wake',
    {
      agentId,
      contactId: conversation.contactId,
      conversationId: conversation.id,
      trigger: 'inbound_message',
    },
    {
      singletonKey: `agents:agent-wake:${agentId}:${conversation.contactId}`,
      startAfter: 2,
    },
  );
}

// ─── Media Upload ──────────────────────────────────────────────────

interface MediaUploadResult {
  contentType: 'image' | 'document' | 'audio' | 'video';
  media: Array<{
    type: string;
    url: string;
    mimeType: string;
    filename?: string;
  }>;
}

/**
 * Upload inbound media to storage bucket `chat-attachments`.
 * Returns null if no media or storage is unavailable.
 */
async function uploadInboundMedia(
  storage: StorageService | undefined,
  conversationId: string,
  event: MessageReceivedEvent,
): Promise<MediaUploadResult | null> {
  if (!event.media || event.media.length === 0 || !storage) return null;

  const bucket = storage.bucket('chat-attachments');
  const uploaded: MediaUploadResult['media'] = [];

  for (const media of event.media) {
    const filename =
      media.filename ??
      `${event.messageId ?? Date.now()}.${extensionFromMime(media.mimeType)}`;
    const key = `${conversationId}/${event.messageId ?? Date.now()}/${filename}`;

    try {
      await bucket.upload(key, media.data, { contentType: media.mimeType });
      const url = bucket.presign(key);
      uploaded.push({
        type: media.type,
        url,
        mimeType: media.mimeType,
        filename: media.filename,
      });
    } catch (err) {
      logger.error('[conversations] Failed to upload inbound media', {
        conversationId,
        filename,
        error: err,
      });
    }
  }

  if (uploaded.length === 0) return null;

  return {
    contentType: uploaded[0].type as MediaUploadResult['contentType'],
    media: uploaded,
  };
}

function extensionFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'video/mp4': 'mp4',
    'application/pdf': 'pdf',
  };
  return map[mimeType] ?? 'bin';
}

// ─── Session Upsert ────────────────────────────────────────────────

/**
 * Upsert channel session if the channel type supports messaging windows.
 * Uses pre-resolved channel info to avoid duplicate DB lookups.
 */
async function upsertSessionIfWindowed(
  db: VobaseDb,
  conversationId: string,
  channelInstanceId: string,
  channelInfo: {
    type: string;
    adapter: ReturnType<ChannelsService['getAdapter']>;
  } | null,
): Promise<void> {
  if (!channelInfo?.adapter?.capabilities?.messagingWindow) return;

  await upsertSession(db, {
    conversationId,
    channelInstanceId,
    channelType: channelInfo.type,
  });
}
