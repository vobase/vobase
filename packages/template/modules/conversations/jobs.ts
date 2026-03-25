import { defineJob, logger } from '@vobase/core';
import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';

import { getConversationsDeps } from './lib/deps';

const sendDataSchema = z.object({ outboxId: z.string().min(1) });
const channelReplyDataSchema = z.object({
  sessionId: z.string().min(1),
  inboundContent: z.string().optional(),
});

/**
 * conversations:send — Process a queued outbox message.
 * Loads the outbox record, sends via channels, updates status.
 */
export const sendJob = defineJob('conversations:send', async (data) => {
  const { outboxId } = sendDataSchema.parse(data);
  const deps = getConversationsDeps();

  const { processOutboxMessage } = await import('./lib/outbox');
  await processOutboxMessage(deps.db, deps.channels, outboxId);
});

/**
 * conversations:channel-reply — Generate AI reply for a channel session.
 * Called after an inbound message is routed to an active session.
 */
export const channelReplyJob = defineJob(
  'conversations:channel-reply',
  async (data) => {
    const { sessionId, inboundContent } = channelReplyDataSchema.parse(data);
    const deps = getConversationsDeps();

    const { generateChannelReply } = await import('./lib/channel-reply');
    await generateChannelReply(deps, sessionId, inboundContent);
  },
);

/**
 * conversations:consultation-timeout — Cron every 5 minutes.
 * Check and handle timed-out consultations.
 */
export const consultationTimeoutJob = defineJob(
  'conversations:consultation-timeout',
  async () => {
    const deps = getConversationsDeps();

    const { checkConsultationTimeouts } = await import('./lib/consult-human');
    const count = await checkConsultationTimeouts(deps.db, deps.channels);
    if (count > 0) {
      logger.info('[conversations] Processed consultation timeouts', {
        count,
      });
    }
  },
);

/**
 * conversations:session-cleanup — Cron daily.
 * Complete sessions that have been inactive for 7+ days.
 */
export const sessionCleanupJob = defineJob(
  'conversations:session-cleanup',
  async () => {
    const deps = getConversationsDeps();
    const { sessions } = await import('./schema');

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const stale = await deps.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.status, 'active'),
          lt(sessions.updatedAt, sevenDaysAgo),
        ),
      );

    if (stale.length === 0) return;

    const { completeSession } = await import('./lib/session');
    for (const s of stale) {
      await completeSession(deps.db, s.id);
    }

    logger.info('[conversations] Cleaned up stale sessions', {
      count: stale.length,
    });
  },
);
