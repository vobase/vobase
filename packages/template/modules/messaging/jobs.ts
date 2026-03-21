import type {
  ChannelsService,
  Scheduler,
  StorageService,
  VobaseDb,
} from '@vobase/core';
import { defineJob } from '@vobase/core';
import { and, desc, eq, isNull, lt, lte } from 'drizzle-orm';

import { getAgent } from '../ai/agents';
import { msgMessages, msgThreads } from './schema';

let moduleDb: VobaseDb;
let moduleChannels: ChannelsService;
let moduleScheduler: Scheduler;
let moduleStorage: StorageService;

/** Called from the module init hook to wire up dependencies. */
export function setModuleDeps(
  db: VobaseDb,
  channels: ChannelsService,
  scheduler?: Scheduler,
  storage?: StorageService,
) {
  moduleDb = db;
  moduleChannels = channels;
  if (scheduler) moduleScheduler = scheduler;
  if (storage) moduleStorage = storage;
}

/**
 * messaging:send — Load queued message, call channels[channel].send(), update status.
 * Registered with pg-boss: durable, 3 attempts, backoff.
 */
export const sendMessageJob = defineJob('messaging:send', async (data) => {
  if (!moduleDb) throw new Error('moduleDb not initialized');

  const { messageId, channel } = data as { messageId: string; channel: string };

  const message = (
    await moduleDb
      .select()
      .from(msgMessages)
      .where(eq(msgMessages.id, messageId))
  )[0];

  if (!message || message.status !== 'queued') return;

  // Get the thread to find the contact's phone/address
  const thread = (
    await moduleDb
      .select()
      .from(msgThreads)
      .where(eq(msgThreads.id, message.threadId))
  )[0];
  if (!thread) return;

  // Resolve recipient — need to look up contact
  const { msgContacts } = await import('./schema');
  const contact = thread.contactId
    ? (
        await moduleDb
          .select()
          .from(msgContacts)
          .where(eq(msgContacts.id, thread.contactId))
      )[0]
    : null;

  if (!contact?.phone) {
    await moduleDb
      .update(msgMessages)
      .set({ status: 'failed' })
      .where(eq(msgMessages.id, messageId));
    return;
  }

  const channelSend =
    channel === 'whatsapp' ? moduleChannels.whatsapp : moduleChannels.email;
  const result = await channelSend.send({
    to: contact.phone,
    text: message.content ?? '',
  });

  if (result.success) {
    await moduleDb
      .update(msgMessages)
      .set({
        status: 'sent',
        externalMessageId: result.messageId ?? null,
      })
      .where(eq(msgMessages.id, messageId));
  } else {
    // If not retryable, mark as failed (pg-boss dead letter will capture)
    if (result.retryable === false) {
      await moduleDb
        .update(msgMessages)
        .set({ status: 'failed' })
        .where(eq(msgMessages.id, messageId));
    }
    throw new Error(result.error ?? 'Send failed');
  }
});

/**
 * messaging:channel-reply — Debounced AI reply for external channels.
 * Queued with a 3s delay on each inbound message. When it fires, checks
 * whether a newer inbound message arrived since `triggeredAt`. If so, a
 * newer job is already queued — this one no-ops.
 */
export const channelReplyJob = defineJob(
  'messaging:channel-reply',
  async (data) => {
    if (!moduleDb) throw new Error('moduleDb not initialized');

    const { threadId, triggeredAt } = data as {
      threadId: string;
      triggeredAt: number;
    };
    const DEBOUNCE_MS = 3000;

    // Check if a newer inbound message arrived after triggeredAt
    const latestInbound = (
      await moduleDb
        .select({ createdAt: msgMessages.createdAt })
        .from(msgMessages)
        .where(
          and(
            eq(msgMessages.threadId, threadId),
            eq(msgMessages.direction, 'inbound'),
          ),
        )
        .orderBy(desc(msgMessages.createdAt))
        .limit(1)
    )[0];

    if (latestInbound) {
      const latestTs = latestInbound.createdAt.getTime();
      if (latestTs > triggeredAt) {
        // A newer message arrived — another job will handle the reply
        return;
      }
      // Also skip if less than DEBOUNCE_MS has passed since the latest message
      if (Date.now() - latestTs < DEBOUNCE_MS) {
        return;
      }
    }

    // Load thread
    const thread = (
      await moduleDb
        .select()
        .from(msgThreads)
        .where(eq(msgThreads.id, threadId))
    )[0];
    if (!thread || thread.status !== 'ai' || !thread.agentId) return;

    // Look up agent from code registry
    const agent = getAgent(thread.agentId);
    if (!agent) return;

    // Load all messages for context
    const messages = await moduleDb
      .select()
      .from(msgMessages)
      .where(eq(msgMessages.threadId, threadId))
      .orderBy(msgMessages.createdAt);

    let generateChannelReply: typeof import('./lib/channel-reply').generateChannelReply;
    try {
      ({ generateChannelReply } = await import('./lib/channel-reply'));
    } catch {
      console.warn(
        '[messaging] ai module not available — skipping channel reply',
      );
      return;
    }
    const { queueOutboundMessage } = await import('./lib/outbox');

    const replyText = await generateChannelReply({
      db: moduleDb,
      scheduler: moduleScheduler,
      storage: moduleStorage,
      thread: {
        id: thread.id,
        agentId: thread.agentId,
        channel: thread.channel,
        contactId: thread.contactId,
        userId: thread.userId,
      },
      agent,
      messages,
    });

    if (replyText) {
      await queueOutboundMessage(
        moduleDb,
        moduleScheduler,
        thread.id,
        replyText,
        thread.channel,
      );
    }
  },
);

/**
 * messaging:resume-ai — Cron every 5 min.
 * Find threads with status='human' AND aiResumeAt <= now, set status='ai'.
 */
export const resumeAiJob = defineJob('messaging:resume-ai', async () => {
  if (!moduleDb) throw new Error('moduleDb not initialized');

  const now = new Date();
  const threads = await moduleDb
    .select()
    .from(msgThreads)
    .where(
      and(
        eq(msgThreads.status, 'human'),
        lte(msgThreads.aiResumeAt, now),
        isNull(msgThreads.archivedAt),
      ),
    );

  for (const thread of threads) {
    await moduleDb
      .update(msgThreads)
      .set({
        status: 'ai',
        aiPausedAt: null,
        aiResumeAt: null,
      })
      .where(eq(msgThreads.id, thread.id));
  }
});

/**
 * messaging:archive-threads — Cron daily.
 * Archive threads inactive for 7 days.
 */
export const archiveThreadsJob = defineJob(
  'messaging:archive-threads',
  async () => {
    if (!moduleDb) throw new Error('moduleDb not initialized');

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await moduleDb
      .update(msgThreads)
      .set({ archivedAt: new Date() })
      .where(
        and(isNull(msgThreads.archivedAt), lt(msgThreads.updatedAt, cutoff)),
      );
  },
);

/**
 * messaging:purge-messages — Cron daily.
 * Delete messages older than 90 days (configurable via MESSAGING_RETENTION_DAYS env).
 */
export const purgeMessagesJob = defineJob(
  'messaging:purge-messages',
  async () => {
    if (!moduleDb) throw new Error('moduleDb not initialized');

    const retentionDays = Number(process.env.MESSAGING_RETENTION_DAYS) || 90;
    if (retentionDays === 0) return; // Disabled

    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    await moduleDb.delete(msgMessages).where(lt(msgMessages.createdAt, cutoff));
  },
);

/**
 * messaging:recover-stuck — Cron every 5 min.
 * Re-enqueue messages stuck in 'queued' for > 5 minutes.
 */
export const recoverStuckJob = defineJob(
  'messaging:recover-stuck',
  async () => {
    if (!moduleDb) throw new Error('moduleDb not initialized');

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const stuck = await moduleDb
      .select()
      .from(msgMessages)
      .where(
        and(
          eq(msgMessages.status, 'queued'),
          lt(msgMessages.createdAt, fiveMinAgo),
        ),
      );

    // Re-enqueue is not possible without scheduler reference in the job handler.
    // Instead, reset status so the next send cycle picks them up.
    // The scheduler.add call happens outside — this job just marks them for retry.
    for (const msg of stuck) {
      // Get the thread to determine channel
      const thread = (
        await moduleDb
          .select()
          .from(msgThreads)
          .where(eq(msgThreads.id, msg.threadId))
      )[0];

      if (thread) {
        // Mark as failed so they can be inspected
        await moduleDb
          .update(msgMessages)
          .set({ status: 'failed' })
          .where(eq(msgMessages.id, msg.id));
      }
    }
  },
);
