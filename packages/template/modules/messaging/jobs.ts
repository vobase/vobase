import type {
  ChannelsService,
  Scheduler,
  StorageService,
  VobaseDb,
} from '@vobase/core';
import { defineJob } from '@vobase/core';
import { and, eq, isNull, lt, lte } from 'drizzle-orm';

import { getAgent } from '../ai/agents';
import { loadThreadMessages } from './lib/memory-bridge';
import { msgContacts, msgOutbox, msgThreads } from './schema';

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
 * messaging:send — Load queued outbox row, call channels[channel].send(), update status.
 */
export const sendMessageJob = defineJob('messaging:send', async (data) => {
  if (!moduleDb) throw new Error('moduleDb not initialized');

  const { messageId, channel } = data as { messageId: string; channel: string };

  const outboxRow = (
    await moduleDb.select().from(msgOutbox).where(eq(msgOutbox.id, messageId))
  )[0];

  if (!outboxRow || outboxRow.status !== 'queued') return;

  const thread = (
    await moduleDb
      .select()
      .from(msgThreads)
      .where(eq(msgThreads.id, outboxRow.threadId))
  )[0];
  if (!thread) return;

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
      .update(msgOutbox)
      .set({ status: 'failed' })
      .where(eq(msgOutbox.id, messageId));
    return;
  }

  const channelSend =
    channel === 'whatsapp' ? moduleChannels.whatsapp : moduleChannels.email;
  const result = await channelSend.send({
    to: contact.phone,
    text: outboxRow.content,
  });

  if (result.success) {
    await moduleDb
      .update(msgOutbox)
      .set({
        status: 'sent',
        externalMessageId: result.messageId ?? null,
      })
      .where(eq(msgOutbox.id, messageId));
  } else {
    if (result.retryable === false) {
      await moduleDb
        .update(msgOutbox)
        .set({ status: 'failed' })
        .where(eq(msgOutbox.id, messageId));
    }
    throw new Error(result.error ?? 'Send failed');
  }
});

/**
 * messaging:channel-reply — Debounced AI reply for external channels.
 * Messages are loaded from Mastra Memory. The registered agent's DynamicArgument
 * processors handle Memory recall and moderation automatically.
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

    // Simple debounce: skip if less than DEBOUNCE_MS since trigger
    if (Date.now() - triggeredAt < DEBOUNCE_MS) {
      return;
    }

    const thread = (
      await moduleDb
        .select()
        .from(msgThreads)
        .where(eq(msgThreads.id, threadId))
    )[0];
    if (!thread || thread.status !== 'ai' || !thread.agentId) return;

    if (!getAgent(thread.agentId)) return;

    // Load messages from Mastra Memory
    let memoryMessages: Awaited<ReturnType<typeof loadThreadMessages>>;
    try {
      memoryMessages = await loadThreadMessages(threadId);
    } catch {
      console.warn('[messaging] Failed to load messages from Memory');
      return;
    }

    // Convert Memory messages to the format generateChannelReply expects
    const messages = memoryMessages.map((m: any) => ({
      aiRole: m.role as string,
      content:
        typeof m.content === 'string'
          ? m.content
          : (m.content?.parts
              ?.map((p: any) => p.text ?? '')
              .join('')
              .trim() ?? ''),
      attachments: null,
    }));

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
 * Delete delivered outbox entries older than retention period.
 */
export const purgeMessagesJob = defineJob(
  'messaging:purge-messages',
  async () => {
    if (!moduleDb) throw new Error('moduleDb not initialized');

    const retentionDays = Number(process.env.MESSAGING_RETENTION_DAYS) || 90;
    if (retentionDays === 0) return;

    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    await moduleDb.delete(msgOutbox).where(lt(msgOutbox.createdAt, cutoff));
  },
);

/**
 * messaging:recover-stuck — Cron every 5 min.
 * Mark outbox entries stuck in 'queued' for > 5 minutes as failed.
 */
export const recoverStuckJob = defineJob(
  'messaging:recover-stuck',
  async () => {
    if (!moduleDb) throw new Error('moduleDb not initialized');

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const stuck = await moduleDb
      .select()
      .from(msgOutbox)
      .where(
        and(
          eq(msgOutbox.status, 'queued'),
          lt(msgOutbox.createdAt, fiveMinAgo),
        ),
      );

    for (const row of stuck) {
      await moduleDb
        .update(msgOutbox)
        .set({ status: 'failed' })
        .where(eq(msgOutbox.id, row.id));
    }
  },
);
