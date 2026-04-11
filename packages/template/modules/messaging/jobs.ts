import { defineJob, logger } from '@vobase/core';
import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';

import { getModuleDeps } from './lib/deps';

export { setModuleDeps } from './lib/deps';

import { expireSessions } from './lib/channel-sessions';
import { resolveConversation } from './lib/conversation';
import { processDelivery } from './lib/delivery';
import { handleInboundMessage } from './lib/inbound';
import { transition } from './lib/state-machine';
import { channelInstances, conversations } from './schema';

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
