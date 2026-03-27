import { defineJob, logger } from '@vobase/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { getConversationsDeps } from './lib/deps';

const sendDataSchema = z.object({ outboxId: z.string().min(1) });
const channelReplyDataSchema = z.object({
  conversationId: z.string().min(1),
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
  conversationId: z.string().min(1),
  contactId: z.string().min(1),
  agentId: z.string().min(1),
  channelInstanceId: z.string().min(1),
  channelRoutingId: z.string().min(1),
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
 * conversations:channel-reply — Generate AI reply for a channel conversation.
 * Called after an inbound message is routed to an active conversation.
 */
export const channelReplyJob = defineJob(
  'conversations:channel-reply',
  async (data) => {
    const { conversationId, inboundContent } =
      channelReplyDataSchema.parse(data);
    const deps = getConversationsDeps();

    const { generateChannelReply } = await import('./lib/channel-reply');
    await generateChannelReply(deps, conversationId, inboundContent);
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
 * conversations:conversation-cleanup — Cron every 5 minutes.
 * Complete conversations that have exceeded per-channel inactivity timeouts or
 * been stale for 7+ days (abandoned).
 *
 * Per-channel timeouts: web=30min, whatsapp=24h, email=72h.
 * Timed-out conversations resolve as 'resolved' (natural end).
 * 7-day stale conversations resolve as 'abandoned'.
 */
export const conversationCleanupJob = defineJob(
  'conversations:conversation-cleanup',
  async () => {
    const deps = getConversationsDeps();
    const { conversations, channelInstances } = await import('./schema');
    const { completeConversation } = await import('./lib/conversation');

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
      logger.info('[conversations] Conversation cleanup', {
        timedOut: timedOutCount,
        abandoned: abandonedCount,
      });
    }
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
 * conversations:retry-memory-thread — Retry memory thread creation for degraded conversations (C4).
 * Scheduled when initial memory.saveThread fails during conversation creation.
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
          id: input.conversationId,
          title: 'New conversation',
          resourceId: `contact:${input.contactId}`,
          createdAt: now,
          updatedAt: now,
          metadata: {
            agentId: input.agentId,
            channelInstanceId: input.channelInstanceId,
            channelRoutingId: input.channelRoutingId,
          },
        },
      });

      // Clear degraded flag on success
      const { conversations } = await import('./schema');
      await deps.db
        .update(conversations)
        .set({ metadata: {} })
        .where(eq(conversations.id, input.conversationId));

      logger.info('[conversations] Memory thread retry succeeded', {
        conversationId: input.conversationId,
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
            conversationId: input.conversationId,
            attempt: input.attempt,
            error: err,
          },
        );
      } else {
        logger.error('[conversations] Memory thread permanently failed', {
          conversationId: input.conversationId,
          attempts: input.attempt,
          error: err,
        });
      }
    }
  },
);
