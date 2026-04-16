import { defineJob, logger } from '@vobase/core';
import { and, eq, inArray, lt, lte } from 'drizzle-orm';
import { z } from 'zod';

import { getModuleDeps } from './lib/deps';

export { setModuleDeps } from './lib/deps';

import { executeBroadcast } from './lib/broadcast-executor';
import { getCaptionForContentType } from './lib/caption';
import { expireSessions } from './lib/channel-sessions';
import { resolveConversation } from './lib/conversation';
import { processDelivery } from './lib/delivery';
import { handleInboundMessage } from './lib/inbound';
import { transition } from './lib/state-machine';
import {
  broadcasts,
  channelInstances,
  conversations,
  messages,
} from './schema';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Messaging jobs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const deliverDataSchema = z.object({ messageId: z.string().min(1) });
const processInboundDataSchema = z.object({
  event: z
    .object({
      channelInstanceId: z.string().optional(),
      channel: z.string(),
      from: z.string(),
      content: z.string().optional(),
      profileName: z.string().optional(),
      timestamp: z.string().optional(),
    })
    .passthrough(),
});

/**
 * messaging:deliver-message — Process a queued message delivery.
 * Loads the message record, sends via channels, updates status.
 */
export const deliverMessageJob = defineJob(
  'messaging:deliver-message',
  async (data) => {
    const { messageId } = deliverDataSchema.parse(data);
    const deps = getModuleDeps();
    await processDelivery(deps.db, deps.channels, deps.scheduler, messageId);
  },
);

/**
 * messaging:conversation-cleanup — Cron every 5 minutes.
 * Resolve conversations that have exceeded per-channel inactivity timeouts or
 * been stale for 7+ days (abandoned).
 *
 * Per-channel timeouts: web=30min, whatsapp=24h, email=72h.
 * Timed-out conversations resolve as 'resolved' (natural end).
 * 7-day stale conversations resolve as 'abandoned'.
 */
export const conversationCleanupJob = defineJob(
  'messaging:conversation-cleanup',
  async () => {
    const deps = getModuleDeps();

    // Per-channel inactivity timeouts (minutes)
    const timeouts: Record<string, number> = {
      web: 30,
      whatsapp: 24 * 60,
      email: 72 * 60,
    };
    const defaultTimeout = 24 * 60;

    const activeConversations = await deps.db
      .select({
        id: conversations.id,
        updatedAt: conversations.updatedAt,
        channelType: channelInstances.type,
      })
      .from(conversations)
      .innerJoin(
        channelInstances,
        eq(conversations.channelInstanceId, channelInstances.id),
      )
      .where(eq(conversations.status, 'active'));

    const now = Date.now();
    let timedOutCount = 0;
    let abandonedCount = 0;

    for (const s of activeConversations) {
      const timeoutMinutes = timeouts[s.channelType] ?? defaultTimeout;
      const age = (now - s.updatedAt.getTime()) / 60_000;

      if (age > 7 * 24 * 60) {
        // 7-day stale → abandoned
        await resolveConversation(deps.db, s.id, deps.realtime, 'abandoned');
        abandonedCount++;
      } else if (age > timeoutMinutes) {
        // Per-channel timeout → resolved (natural end)
        await resolveConversation(deps.db, s.id, deps.realtime, 'resolved');
        timedOutCount++;
      }
    }

    if (timedOutCount > 0 || abandonedCount > 0) {
      logger.info('[messaging] Conversation cleanup', {
        timedOut: timedOutCount,
        abandoned: abandonedCount,
      });
    }
  },
);

/**
 * messaging:resolving-timeout — Cron every minute.
 * Fail conversations stuck in 'resolving' status for over 60 seconds.
 * This catches zombie resolutions where generation never finished.
 */
export const resolvingTimeoutJob = defineJob(
  'messaging:resolving-timeout',
  async () => {
    const deps = getModuleDeps();
    const sixtySecondsAgo = new Date(Date.now() - 60_000);

    const stuck = await deps.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.status, 'resolving'),
          lt(conversations.updatedAt, sixtySecondsAgo),
        ),
      );

    for (const s of stuck) {
      await transition(deps, s.id, { type: 'RESOLVING_TIMEOUT' });
    }

    if (stuck.length > 0) {
      logger.info('[messaging] Resolving timeout cleanup', {
        count: stuck.length,
      });
    }
  },
);

/**
 * messaging:process-inbound — Retry processing a failed inbound message.
 * Scheduled when handleInboundMessage fails in the event bridge.
 */
export const processInboundJob = defineJob(
  'messaging:process-inbound',
  async (data) => {
    const { event } = processInboundDataSchema.parse(data);
    const deps = getModuleDeps();

    await handleInboundMessage(deps, event as never);
  },
);

/**
 * messaging:session-expiry — Cron every 5 minutes.
 * Bulk-expire channel sessions where the messaging window has passed.
 */
export const sessionExpiryJob = defineJob(
  'messaging:session-expiry',
  async () => {
    const deps = getModuleDeps();
    const count = await expireSessions(deps.db);
    if (count > 0) {
      logger.info('[messaging] Expired channel sessions', { count });
    }
  },
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Media captioning
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const mediaCaptionDataSchema = z.object({ messageId: z.string().min(1) });

const FALLBACK_CAPTION =
  '(media received — caption unavailable, use analyze_media tool to examine)';

/**
 * messaging:process-media-caption — Background captioning for inbound media.
 * Downloads media from storage, generates a structured caption via vision/extraction,
 * and writes it to the dedicated `caption` column on the messages table.
 */
export const processMediaCaptionJob = defineJob(
  'messaging:process-media-caption',
  async (data) => {
    const { messageId } = mediaCaptionDataSchema.parse(data);
    const deps = getModuleDeps();

    // Load message row
    const [row] = await deps.db
      .select({
        id: messages.id,
        contentType: messages.contentType,
        contentData: messages.contentData,
        caption: messages.caption,
      })
      .from(messages)
      .where(eq(messages.id, messageId));

    if (!row) {
      logger.warn('[caption] Message not found', { messageId });
      return;
    }

    // Skip if already captioned
    if (row.caption) return;

    const contentData = (row.contentData ?? {}) as Record<string, unknown>;
    const mediaArray =
      (contentData.media as Array<{ storageKey?: string; mimeType: string }>) ??
      [];
    const firstMedia = mediaArray[0];

    try {
      const caption = await getCaptionForContentType(
        row.contentType,
        firstMedia?.storageKey,
        firstMedia?.mimeType,
        deps.storage,
      );

      await writeCaption(deps.db, messageId, caption || FALLBACK_CAPTION);
    } catch (err) {
      logger.error('[caption] Processing failed — writing fallback', {
        messageId,
        error: err,
      });
      await writeCaption(deps.db, messageId, FALLBACK_CAPTION);
    }
  },
);

/** Write caption to the dedicated column. */
async function writeCaption(
  db: ReturnType<typeof getModuleDeps>['db'],
  messageId: string,
  caption: string,
): Promise<void> {
  await db.update(messages).set({ caption }).where(eq(messages.id, messageId));
}

/**
 * messaging:channel-health-check — Cron every 6 hours.
 * Calls healthCheck() on each registered channel adapter; marks instances 'error' on failure.
 */
export const channelHealthCheckJob = defineJob(
  'messaging:channel-health-check',
  async () => {
    const deps = getModuleDeps();

    const instances = await deps.db
      .select()
      .from(channelInstances)
      .where(inArray(channelInstances.status, ['active', 'error']));

    await Promise.allSettled(
      instances.map(async (instance) => {
        const adapter =
          deps.channels.getAdapter(instance.id) ??
          deps.channels.getAdapter(instance.type);
        if (!adapter?.healthCheck) return;

        try {
          const result = await adapter.healthCheck();
          const newError = result.error ?? null;

          if (!result.ok) {
            const errorMsg = newError ?? 'Health check failed';
            if (
              instance.status !== 'error' ||
              instance.statusError !== errorMsg
            ) {
              await deps.db
                .update(channelInstances)
                .set({ status: 'error', statusError: errorMsg })
                .where(eq(channelInstances.id, instance.id));
            }
            logger.warn('[messaging] Channel health check failed', {
              instanceId: instance.id,
              type: instance.type,
              error: newError,
            });
          } else if (instance.status === 'error') {
            await deps.db
              .update(channelInstances)
              .set({ status: 'active', statusError: null })
              .where(eq(channelInstances.id, instance.id));
            logger.info('[messaging] Channel recovered from error', {
              instanceId: instance.id,
              type: instance.type,
            });
          } else if (newError !== instance.statusError) {
            // Sync warning text (set or clear) only when it actually changed
            await deps.db
              .update(channelInstances)
              .set({ statusError: newError })
              .where(eq(channelInstances.id, instance.id));
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          await deps.db
            .update(channelInstances)
            .set({ status: 'error', statusError: errorMsg })
            .where(eq(channelInstances.id, instance.id));
          logger.error('[messaging] Channel health check error', {
            instanceId: instance.id,
            type: instance.type,
            error: err,
          });
        }
      }),
    );
  },
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Broadcast jobs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const broadcastDataSchema = z.object({ broadcastId: z.string().min(1) });

/**
 * broadcast:execute — Process a broadcast: iterate recipients, send template messages in batches.
 */
export const broadcastExecuteJob = defineJob(
  'broadcast:execute',
  async (data) => {
    const { broadcastId } = broadcastDataSchema.parse(data);
    await executeBroadcast(broadcastId);
  },
);

/**
 * broadcast:check-scheduled — Cron every minute.
 * Find scheduled broadcasts where scheduledAt <= now(), trigger execution.
 */
export const broadcastCheckScheduledJob = defineJob(
  'broadcast:check-scheduled',
  async () => {
    const deps = getModuleDeps();
    const now = new Date();

    const due = await deps.db
      .select({ id: broadcasts.id })
      .from(broadcasts)
      .where(
        and(
          eq(broadcasts.status, 'scheduled'),
          lte(broadcasts.scheduledAt, now),
        ),
      );

    for (const b of due) {
      await deps.db
        .update(broadcasts)
        .set({ status: 'sending', startedAt: now })
        .where(eq(broadcasts.id, b.id));

      await deps.scheduler
        .add('broadcast:execute', { broadcastId: b.id }, { singletonKey: b.id })
        .catch((err) => {
          logger.error('[broadcast] Failed to enqueue scheduled broadcast', {
            broadcastId: b.id,
            error: err,
          });
        });

      logger.info('[broadcast] Triggered scheduled broadcast', {
        broadcastId: b.id,
      });
    }
  },
);

/**
 * broadcast:retry-failed — Re-send queued recipients after a retry.
 * The handler (POST /:id/retry-failed) already resets failed recipients
 * to 'queued' and updates broadcast counters before enqueuing this job.
 */
export const broadcastRetryFailedJob = defineJob(
  'broadcast:retry-failed',
  async (data) => {
    const { broadcastId } = broadcastDataSchema.parse(data);
    await executeBroadcast(broadcastId);
    logger.info('[broadcast] Retry execution finished', { broadcastId });
  },
);
