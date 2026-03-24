import type {
  ChannelsService,
  Scheduler,
  StorageService,
  VobaseDb,
} from '@vobase/core';
import { defineJob } from '@vobase/core';
import { and, count, eq, gt, isNull, lt, lte } from 'drizzle-orm';

import { getAgent } from '../../mastra/agents';
import { loadConversationMessages } from './lib/memory-bridge';
import {
  msgContacts,
  msgConversationLabels,
  msgConversations,
  msgInboxes,
  msgLabels,
  msgOutbox,
} from './schema';

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

  const conversation = (
    await moduleDb
      .select()
      .from(msgConversations)
      .where(eq(msgConversations.id, outboxRow.conversationId))
  )[0];
  if (!conversation) return;

  const contact = conversation.contactId
    ? (
        await moduleDb
          .select()
          .from(msgContacts)
          .where(eq(msgContacts.id, conversation.contactId))
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

    const { conversationId, triggeredAt } = data as {
      conversationId: string;
      triggeredAt: number;
    };
    const DEBOUNCE_MS = 3000;

    // Simple debounce: skip if less than DEBOUNCE_MS since trigger
    if (Date.now() - triggeredAt < DEBOUNCE_MS) {
      return;
    }

    const conversation = (
      await moduleDb
        .select()
        .from(msgConversations)
        .where(eq(msgConversations.id, conversationId))
    )[0];
    if (!conversation || conversation.handler !== 'ai' || !conversation.agentId)
      return;

    if (!getAgent(conversation.agentId)) return;

    // Load messages from Mastra Memory
    let memoryMessages: Awaited<ReturnType<typeof loadConversationMessages>>;
    try {
      memoryMessages = await loadConversationMessages(conversationId);
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
      conversation: {
        id: conversation.id,
        agentId: conversation.agentId,
        channel: conversation.channel,
        contactId: conversation.contactId,
        userId: conversation.userId,
      },
      messages,
    });

    if (replyText) {
      await queueOutboundMessage(
        moduleDb,
        moduleScheduler,
        conversation.id,
        replyText,
        conversation.channel,
      );

      // After first AI response, trigger label suggestion
      const [{ total }] = await moduleDb
        .select({ total: count() })
        .from(msgOutbox)
        .where(eq(msgOutbox.conversationId, conversationId));
      if (total === 1 && moduleScheduler) {
        await moduleScheduler.add('messaging:suggest-labels', {
          conversationId,
        });
      }
    }
  },
);

/**
 * messaging:resume-ai — Cron every 5 min.
 * Find conversations with status='human' AND aiResumeAt <= now, set status='ai'.
 */
export const resumeAiJob = defineJob('messaging:resume-ai', async () => {
  if (!moduleDb) throw new Error('moduleDb not initialized');

  const now = new Date();
  const conversations = await moduleDb
    .select()
    .from(msgConversations)
    .where(
      and(
        eq(msgConversations.handler, 'human'),
        lte(msgConversations.aiResumeAt, now),
        isNull(msgConversations.archivedAt),
      ),
    );

  for (const conversation of conversations) {
    await moduleDb
      .update(msgConversations)
      .set({
        status: 'open',
        handler: 'ai',
        aiPausedAt: null,
        aiResumeAt: null,
      })
      .where(eq(msgConversations.id, conversation.id));
  }
});

/**
 * messaging:archive-conversations — Cron daily.
 * Archive conversations inactive for 7 days.
 */
export const archiveConversationsJob = defineJob(
  'messaging:archive-conversations',
  async () => {
    if (!moduleDb) throw new Error('moduleDb not initialized');

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await moduleDb
      .update(msgConversations)
      .set({ archivedAt: new Date() })
      .where(
        and(
          isNull(msgConversations.archivedAt),
          lt(msgConversations.updatedAt, cutoff),
        ),
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

/**
 * messaging:auto-resolve — Cron every 15 min.
 * Auto-resolve idle AI conversations using the inbox's default agent.
 */
export const autoResolveJob = defineJob('messaging:auto-resolve', async () => {
  if (!moduleDb) throw new Error('moduleDb not initialized');

  const inboxes = await moduleDb
    .select()
    .from(msgInboxes)
    .where(
      and(
        eq(msgInboxes.enabled, true),
        gt(msgInboxes.autoResolveIdleMinutes, 0),
      ),
    );

  for (const inbox of inboxes) {
    const cutoff = new Date(
      Date.now() - inbox.autoResolveIdleMinutes! * 60_000,
    );

    const idleConversations = await moduleDb
      .select()
      .from(msgConversations)
      .where(
        and(
          eq(msgConversations.inboxId, inbox.id),
          eq(msgConversations.status, 'open'),
          eq(msgConversations.handler, 'ai'),
          lte(msgConversations.lastActivityAt, cutoff),
          isNull(msgConversations.archivedAt),
        ),
      );

    for (const conv of idleConversations) {
      try {
        const agent = inbox.defaultAgentId
          ? getAgent(inbox.defaultAgentId)
          : undefined;
        if (!agent) continue;

        const result = await agent.agent.generate(
          [
            {
              role: 'user',
              content: `Evaluate if this conversation is resolved. The customer has been idle for ${inbox.autoResolveIdleMinutes} minutes. If the customer's question has been fully answered, respond with JSON: {"resolved": true, "summary": "brief summary"}. If not resolved, respond with: {"resolved": false, "summary": "what's still pending"}`,
            },
          ],
          { memory: { thread: conv.id, resource: 'system' } },
        );

        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const evaluation = JSON.parse(jsonMatch[0]) as {
            resolved: boolean;
            summary: string;
          };
          if (evaluation.resolved) {
            await moduleDb
              .update(msgConversations)
              .set({
                status: 'resolved',
                handler: 'unassigned',
                resolvedAt: new Date(),
                escalationSummary: evaluation.summary,
              })
              .where(eq(msgConversations.id, conv.id));
          }
        }
      } catch {
        // Skip individual conversation failures
      }
    }
  }
});

/**
 * messaging:suggest-labels — Triggered after first AI response.
 * Ask the agent to suggest labels for the conversation.
 */
export const suggestLabelsJob = defineJob(
  'messaging:suggest-labels',
  async (data) => {
    if (!moduleDb) throw new Error('moduleDb not initialized');

    const { conversationId } = data as { conversationId: string };

    const conv = (
      await moduleDb
        .select()
        .from(msgConversations)
        .where(eq(msgConversations.id, conversationId))
    )[0];
    if (!conv || !conv.agentId) return;

    const agent = getAgent(conv.agentId);
    if (!agent) return;

    try {
      const result = await agent.agent.generate(
        [
          {
            role: 'user',
            content:
              'Based on this conversation, suggest 1-3 short labels/tags that categorize the topic. Respond with JSON only: {"labels": ["label1", "label2"]}',
          },
        ],
        { memory: { thread: conv.id, resource: 'system' } },
      );

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const { labels } = JSON.parse(jsonMatch[0]) as { labels: string[] };
      if (!Array.isArray(labels)) return;

      for (const name of labels.slice(0, 3)) {
        const trimmed = name.trim().toLowerCase();
        if (!trimmed) continue;

        let label = (
          await moduleDb
            .select()
            .from(msgLabels)
            .where(eq(msgLabels.name, trimmed))
        )[0];
        if (!label) {
          [label] = await moduleDb
            .insert(msgLabels)
            .values({ name: trimmed })
            .returning();
        }

        await moduleDb
          .insert(msgConversationLabels)
          .values({ conversationId, labelId: label.id })
          .onConflictDoNothing();
      }
    } catch {
      // Label suggestion is best-effort
    }
  },
);

/**
 * messaging:wake-snoozed — Cron every 5 min.
 * Re-open snoozed conversations whose snooze period has elapsed.
 */
export const wakeSnoozedJob = defineJob('messaging:wake-snoozed', async () => {
  if (!moduleDb) throw new Error('moduleDb not initialized');

  const now = new Date();
  const snoozed = await moduleDb
    .select()
    .from(msgConversations)
    .where(
      and(
        eq(msgConversations.status, 'snoozed'),
        lte(msgConversations.snoozedUntil, now),
        isNull(msgConversations.archivedAt),
      ),
    );

  for (const conv of snoozed) {
    await moduleDb
      .update(msgConversations)
      .set({ status: 'open', handler: 'ai', snoozedUntil: null })
      .where(eq(msgConversations.id, conv.id));
  }
});
