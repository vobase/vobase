import { defineJob, logger } from '@vobase/core';
import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';

import { getModuleDb, getModuleDeps } from './lib/deps';

export { setModuleDeps } from './lib/deps';

import { runAgentEvals } from '../../mastra/evals/runner';
import { getActiveCustomScorers } from '../../mastra/evals/scorers';
import { generateChannelReply } from './lib/channel-reply';
import { expireSessions } from './lib/channel-sessions';
import { checkConsultationTimeouts } from './lib/consult-human';
import { completeConversation } from './lib/conversation';
import { processDelivery } from './lib/delivery';
import { handleInboundMessage } from './lib/inbound';
import { transition } from './lib/state-machine';
import { aiEvalRuns, channelInstances, conversations } from './schema';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI Eval jobs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const evalRunDataSchema = z.object({ runId: z.string().min(1) });

/**
 * ai:eval-run — Execute eval scorers against provided data items.
 * Loads the eval run row, runs scorers, writes results back.
 */
export const evalRunJob = defineJob('ai:eval-run', async (data) => {
  const moduleDb = getModuleDb();
  const { runId } = evalRunDataSchema.parse(data);

  const run = (
    await moduleDb.select().from(aiEvalRuns).where(eq(aiEvalRuns.id, runId))
  )[0];
  if (!run || run.status !== 'pending') return;

  await moduleDb
    .update(aiEvalRuns)
    .set({ status: 'running' })
    .where(eq(aiEvalRuns.id, runId));

  try {
    const parsed = JSON.parse(run.results ?? '[]');
    const evalData: Array<{
      input: string;
      output: string;
      context: string[];
    }> = Array.isArray(parsed) ? parsed : [];

    const customScorers = await getActiveCustomScorers(moduleDb);
    const result = await runAgentEvals({
      data: evalData,
      additionalScorers: customScorers,
    });

    await moduleDb
      .update(aiEvalRuns)
      .set({
        status: 'complete',
        results: JSON.stringify(result),
        completedAt: new Date(),
      })
      .where(eq(aiEvalRuns.id, runId));
  } catch (err) {
    await moduleDb
      .update(aiEvalRuns)
      .set({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Unknown eval error',
        completedAt: new Date(),
      })
      .where(eq(aiEvalRuns.id, runId));
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Conversations & Channel jobs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const deliverDataSchema = z.object({ messageId: z.string().min(1) });
const channelReplyDataSchema = z.object({
  conversationId: z.string().min(1),
});
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
 * ai:deliver-message — Process a queued message delivery.
 * Loads the message record, sends via channels, updates status.
 */
export const deliverMessageJob = defineJob(
  'ai:deliver-message',
  async (data) => {
    const { messageId } = deliverDataSchema.parse(data);
    const deps = getModuleDeps();
    await processDelivery(deps.db, deps.channels, deps.scheduler, messageId);
  },
);

/**
 * ai:channel-reply — Generate AI reply for a channel conversation.
 * Called after an inbound message is routed to an active conversation.
 */
export const channelReplyJob = defineJob('ai:channel-reply', async (data) => {
  const { conversationId } = channelReplyDataSchema.parse(data);
  const deps = getModuleDeps();

  await generateChannelReply(deps, conversationId);
});

/**
 * ai:consultation-timeout — Cron every 5 minutes.
 * Check and handle timed-out consultations.
 */
export const consultationTimeoutJob = defineJob(
  'ai:consultation-timeout',
  async () => {
    const deps = getModuleDeps();

    const count = await checkConsultationTimeouts(deps);
    if (count > 0) {
      logger.info('[ai] Processed consultation timeouts', {
        count,
      });
    }
  },
);

/**
 * ai:conversation-cleanup — Cron every 5 minutes.
 * Complete conversations that have exceeded per-channel inactivity timeouts or
 * been stale for 7+ days (abandoned).
 *
 * Per-channel timeouts: web=30min, whatsapp=24h, email=72h.
 * Timed-out conversations resolve as 'resolved' (natural end).
 * 7-day stale conversations resolve as 'abandoned'.
 */
export const conversationCleanupJob = defineJob(
  'ai:conversation-cleanup',
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
        await completeConversation(deps.db, s.id, deps.realtime, 'abandoned');
        abandonedCount++;
      } else if (age > timeoutMinutes) {
        // Per-channel timeout → resolved (natural end)
        await completeConversation(deps.db, s.id, deps.realtime, 'resolved');
        timedOutCount++;
      }
    }

    if (timedOutCount > 0 || abandonedCount > 0) {
      logger.info('[ai] Conversation cleanup', {
        timedOut: timedOutCount,
        abandoned: abandonedCount,
      });
    }
  },
);

/**
 * ai:completing-timeout — Cron every minute.
 * Fail conversations stuck in 'completing' status for over 60 seconds.
 * This catches zombie completions where generation never finished.
 */
export const completingTimeoutJob = defineJob(
  'ai:completing-timeout',
  async () => {
    const deps = getModuleDeps();
    const sixtySecondsAgo = new Date(Date.now() - 60_000);

    const stuck = await deps.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.status, 'completing'),
          lt(conversations.updatedAt, sixtySecondsAgo),
        ),
      );

    for (const s of stuck) {
      await transition(deps, s.id, { type: 'COMPLETING_TIMEOUT' });
    }

    if (stuck.length > 0) {
      logger.info('[ai] Completing timeout cleanup', { count: stuck.length });
    }
  },
);

/**
 * ai:process-inbound — Retry processing a failed inbound message.
 * Scheduled when handleInboundMessage fails in the event bridge.
 */
export const processInboundJob = defineJob(
  'ai:process-inbound',
  async (data) => {
    const { event } = processInboundDataSchema.parse(data);
    const deps = getModuleDeps();

    await handleInboundMessage(deps, event as never);
  },
);

/**
 * ai:session-expiry — Cron every 5 minutes.
 * Bulk-expire channel sessions where the messaging window has passed.
 */
export const sessionExpiryJob = defineJob('ai:session-expiry', async () => {
  const deps = getModuleDeps();
  const count = await expireSessions(deps.db);
  if (count > 0) {
    logger.info('[ai] Expired channel sessions', { count });
  }
});
