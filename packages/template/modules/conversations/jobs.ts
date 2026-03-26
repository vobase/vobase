import { defineJob, logger } from '@vobase/core';
import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';

import { getConversationsDeps } from './lib/deps';

const sendDataSchema = z.object({ outboxId: z.string().min(1) });
const channelReplyDataSchema = z.object({
  sessionId: z.string().min(1),
  inboundContent: z.string().optional(),
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
  adapterName: z.string(),
});
const retryMemoryDataSchema = z.object({
  sessionId: z.string().min(1),
  contactId: z.string().min(1),
  agentId: z.string().min(1),
  channelInstanceId: z.string().min(1),
  endpointId: z.string().min(1),
  attempt: z.number().int().min(1),
});

/**
 * conversations:send — Process a queued outbox message.
 * Loads the outbox record, sends via channels, updates status.
 */
export const sendJob = defineJob('conversations:send', async (data) => {
  const { outboxId } = sendDataSchema.parse(data);
  const deps = getConversationsDeps();

  const { processOutboxMessage } = await import('./lib/outbox');
  await processOutboxMessage(deps.db, deps.channels, deps.scheduler, outboxId);
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

/**
 * conversations:process-inbound — Retry processing a failed inbound message (C1).
 * Scheduled when chat.processMessage fails in the event bridge.
 */
export const processInboundJob = defineJob(
  'conversations:process-inbound',
  async (data) => {
    const { event, adapterName } = processInboundDataSchema.parse(data);
    const _deps = getConversationsDeps();

    const { getChat } = await import('./lib/chat-init');
    const chat = getChat();

    const adapter = (chat as unknown as { adapters: Record<string, unknown> })
      .adapters[adapterName];

    if (!adapter) {
      logger.error('[conversations] Retry: no adapter for channel', {
        adapterName,
      });
      return;
    }

    const bridgeAdapter = adapter as {
      parseMessage: (raw: unknown) => unknown;
    };
    const message = bridgeAdapter.parseMessage(event);

    chat.processMessage(adapter as never, event.from, message as never);
  },
);

const MEMORY_RETRY_MAX = 3;

/**
 * conversations:retry-memory-thread — Retry memory thread creation for degraded sessions (C4).
 * Scheduled when initial memory.saveThread fails during session creation.
 */
export const retryMemoryThreadJob = defineJob(
  'conversations:retry-memory-thread',
  async (data) => {
    const input = retryMemoryDataSchema.parse(data);
    const deps = getConversationsDeps();

    try {
      const { getMemory } = await import('../../mastra');
      const memory = getMemory();
      const now = new Date();

      await memory.saveThread({
        thread: {
          id: input.sessionId,
          title: 'New conversation',
          resourceId: `contact:${input.contactId}`,
          createdAt: now,
          updatedAt: now,
          metadata: {
            agentId: input.agentId,
            channelInstanceId: input.channelInstanceId,
            endpointId: input.endpointId,
          },
        },
      });

      // Clear degraded flag on success
      const { sessions } = await import('./schema');
      await deps.db
        .update(sessions)
        .set({ metadata: {} })
        .where(eq(sessions.id, input.sessionId));

      logger.info('[conversations] Memory thread retry succeeded', {
        sessionId: input.sessionId,
        attempt: input.attempt,
      });
    } catch (err) {
      if (input.attempt < MEMORY_RETRY_MAX) {
        const backoffMs = 2 ** input.attempt * 2000;
        await deps.scheduler.add(
          'conversations:retry-memory-thread',
          { ...input, attempt: input.attempt + 1 },
          { startAfter: new Date(Date.now() + backoffMs).toISOString() },
        );
        logger.warn(
          '[conversations] Memory thread retry failed, rescheduling',
          {
            sessionId: input.sessionId,
            attempt: input.attempt,
            error: err,
          },
        );
      } else {
        logger.error('[conversations] Memory thread permanently failed', {
          sessionId: input.sessionId,
          attempts: input.attempt,
          error: err,
        });
      }
    }
  },
);
