/**
 * Inbound message handler — processes channel messages directly (no chat-sdk).
 *
 * Single entry point for all inbound channel messages — no chat-sdk dependency.
 * Handles staff reply intercept, contact resolution, interaction dedup,
 * reopen logic, new interaction creation, mode routing, and action button replies.
 *
 * TOCTOU note: The reopen check here is a "soft filter" (optimization to avoid
 * unnecessary REOPEN attempts). The state machine's REOPEN guard is the "hard filter"
 * (authoritative). If the idle window expires between the two checks, the state machine
 * rejects and we fall back to creating a new interaction.
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
  consultations,
  interactions,
} from '../schema';
import { getConstraints } from './channel-constraints';
import { upsertSession } from './channel-sessions';
import { handleStaffReply } from './consult-human';
import { enqueueDelivery } from './delivery';
import { createInteraction, reopenInteraction } from './interaction';
import { insertMessage } from './messages';
import { findContactByAddress, findOrCreateContact } from './routing';
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
 * 3. Interaction dedup — find active/resolving interaction, or reopen resolved, or create new
 * 4. Insert inbound message
 * 5. Route by mode (held → canned response, ai/supervised → channel-reply job, human → noop)
 */
export async function handleInboundMessage(
  deps: InboundDeps,
  event: MessageReceivedEvent,
): Promise<void> {
  const { db, scheduler, channels, realtime } = deps;

  try {
    const channelInstanceId = event.channelInstanceId ?? event.channel;

    // 1. Staff reply intercept — check if sender is staff with pending consultation
    const staffContact = await findContactByAddress(db, event);
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
          event,
        );
        return;
      }
    }

    // 2. Resolve or create contact
    const contact = staffContact ?? (await findOrCreateContact(db, event));

    // 3a. Check for existing active or resolving interaction
    const [existingInteraction] = await db
      .select()
      .from(interactions)
      .where(
        and(
          eq(interactions.contactId, contact.id),
          eq(interactions.channelInstanceId, channelInstanceId),
          inArray(interactions.status, ['active', 'resolving']),
        ),
      );

    if (existingInteraction) {
      await appendAndRoute(
        deps,
        existingInteraction,
        event,
        contact.id,
        channelInstanceId,
      );
      return;
    }

    // 3b. Check for reopenable interaction: resolved within idle window, no topicChangePending
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
      .from(interactions)
      .where(
        and(
          eq(interactions.contactId, contact.id),
          eq(interactions.channelInstanceId, channelInstanceId),
          eq(interactions.status, 'resolved'),
          gt(interactions.resolvedAt, idleThreshold),
          eq(interactions.topicChangePending, false),
        ),
      )
      .orderBy(desc(interactions.resolvedAt))
      .limit(1);

    if (reopenable) {
      // Soft filter passed — attempt reopen via state machine (hard filter)
      const reopenResult = await reopenInteraction(
        { db, realtime },
        reopenable.id,
        idleWindowMs,
      );

      if (reopenResult.ok) {
        // Re-read the interaction after reopen to get updated state
        const [reopened] = await db
          .select()
          .from(interactions)
          .where(eq(interactions.id, reopenable.id));

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

    // 4. New interaction — find channelRouting by channel instance
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
        '[interactions] No enabled channelRouting for channel instance',
        {
          channelInstanceId,
          from: event.from,
        },
      );
      return;
    }

    // Create interaction
    const interaction = await createInteraction(
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
      interaction,
      event,
      contact.id,
      channelInstanceId,
    );
  } catch (err) {
    logger.error('[interactions] Inbound message handler failed', {
      from: event.from,
      channel: event.channel,
      error: err,
    });
  }
}

/**
 * Append an inbound message to an interaction and route by mode.
 * Shared by existing-interaction, reopened-interaction, and new-interaction paths.
 */
async function appendAndRoute(
  deps: InboundDeps,
  interaction: {
    id: string;
    mode: string | null;
    contactId: string;
    channelInstanceId: string;
  },
  event: MessageReceivedEvent,
  contactId: string,
  channelInstanceId: string,
): Promise<void> {
  const { db, scheduler, channels, realtime, storage } = deps;

  // Upload inbound media to storage
  const mediaResult = await uploadInboundMedia(storage, interaction.id, event);

  // Store inbound message
  if (event.content || mediaResult) {
    await insertMessage(db, realtime, {
      interactionId: interaction.id,
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
    interaction.id,
    channelInstanceId,
    channelInfo,
  );

  await routeByMode(
    { db, scheduler, channels, realtime },
    interaction,
    event.content,
    contactId,
    channelInfo,
  );
}

/**
 * Handle an interactive button action reply (e.g. WhatsApp interactive buttons).
 * Decodes the button callback data and schedules a channel-reply job.
 */
export async function handleInboundAction(
  deps: { db: VobaseDb; scheduler: Scheduler; realtime: RealtimeService },
  event: { threadId: string; actionId: string },
): Promise<void> {
  try {
    const { actionId } = event;
    if (!actionId?.startsWith('chat:')) return;

    const data = JSON.parse(actionId.slice(5));
    logger.info('[interactions] Action received', {
      threadId: event.threadId,
      data,
    });

    // Store the button action as an inbound message so the agent sees which button was pressed
    const label = (data as Record<string, unknown>).label ?? actionId.slice(5);
    await insertMessage(deps.db, deps.realtime, {
      interactionId: event.threadId,
      messageType: 'incoming',
      contentType: 'interactive',
      content: `[Button: ${label}]`,
      contentData: { action: data },
      senderId: 'contact',
      senderType: 'contact',
      channelType: 'whatsapp',
    });

    await deps.scheduler.add('ai:channel-reply', {
      interactionId: event.threadId,
    });
  } catch (err) {
    logger.error('[interactions] Action handler failed', { error: err });
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
  return { type: instance.type, adapter: channels.getAdapter(instance.type) };
}

// ─── Mode routing ───────────────────────────────────────────────────

async function routeByMode(
  deps: {
    db: VobaseDb;
    scheduler: Scheduler;
    channels: ChannelsService;
    realtime: RealtimeService;
  },
  interaction: {
    id: string;
    mode: string | null;
    contactId: string;
    channelInstanceId: string;
  },
  messageText: string | undefined,
  contactId: string,
  channelInfo: {
    type: string;
    adapter: ReturnType<ChannelsService['getAdapter']>;
  } | null,
): Promise<void> {
  const { db, scheduler, realtime } = deps;
  const mode = interaction.mode ?? 'ai';

  // Delegate all state mutations to the machine
  await transition({ db, realtime }, interaction.id, {
    type: 'INBOUND_MESSAGE',
    contactId,
    content: messageText,
  });

  if (mode === 'human') {
    return;
  }

  if (mode === 'held') {
    const msg = await insertMessage(db, realtime, {
      interactionId: interaction.id,
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

  // 'ai' or 'supervised' — schedule channel-reply job with per-channel debounce
  const debounceMs = channelInfo?.adapter?.debounceWindowMs ?? 0;
  await scheduler.add(
    'ai:channel-reply',
    { interactionId: interaction.id },
    debounceMs > 0
      ? {
          singletonKey: `channel-reply:${interaction.id}`,
          startAfter: Math.ceil(debounceMs / 1000),
        }
      : undefined,
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
  interactionId: string,
  event: MessageReceivedEvent,
): Promise<MediaUploadResult | null> {
  if (!event.media || event.media.length === 0 || !storage) return null;

  const bucket = storage.bucket('chat-attachments');
  const uploaded: MediaUploadResult['media'] = [];

  for (const media of event.media) {
    const filename =
      media.filename ??
      `${event.messageId ?? Date.now()}.${extensionFromMime(media.mimeType)}`;
    const key = `${interactionId}/${event.messageId ?? Date.now()}/${filename}`;

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
      logger.error('[interactions] Failed to upload inbound media', {
        interactionId,
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
  interactionId: string,
  channelInstanceId: string,
  channelInfo: {
    type: string;
    adapter: ReturnType<ChannelsService['getAdapter']>;
  } | null,
): Promise<void> {
  if (!channelInfo?.adapter?.capabilities?.messagingWindow) return;

  await upsertSession(db, {
    interactionId,
    channelInstanceId,
    channelType: channelInfo.type,
  });
}
