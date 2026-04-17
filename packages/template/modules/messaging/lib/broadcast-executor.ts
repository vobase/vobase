import { logger } from '@vobase/core';
import { and, eq, sql } from 'drizzle-orm';

import { broadcastRecipients, broadcasts, channelInstances } from '../schema';
import { getModuleDeps } from './deps';
import {
  type BatchStats,
  type CounterDelta,
  executeSendBatch,
  type FinalOutcome,
  type HaltReason,
  type SendRecipient,
} from './send-executor';

/** Execute a broadcast via the generic send-executor. */
export async function executeBroadcast(
  broadcastId: string,
  options?: { batchSize?: number; delayMs?: number },
): Promise<void> {
  const { db, scheduler, channels, realtime } = getModuleDeps();

  const [broadcast] = await db
    .select()
    .from(broadcasts)
    .where(eq(broadcasts.id, broadcastId));

  if (!broadcast) {
    logger.warn('[broadcast] Broadcast not found', { broadcastId });
    return;
  }

  if (broadcast.status !== 'sending') {
    logger.warn('[broadcast] Broadcast not in sending status — skipping', {
      broadcastId,
      status: broadcast.status,
    });
    return;
  }

  const [channelInstance] = await db
    .select()
    .from(channelInstances)
    .where(eq(channelInstances.id, broadcast.channelInstanceId));

  const adapter =
    channels.getAdapter(broadcast.channelInstanceId) ??
    channels.getAdapter('whatsapp');

  if (!adapter) {
    logger.warn('[broadcast] No adapter found for broadcast', {
      broadcastId,
      channelInstanceId: broadcast.channelInstanceId,
    });
    return;
  }

  const channelType = channelInstance?.type ?? 'whatsapp';

  await executeSendBatch({
    adapter,
    channelType,
    batchSize: options?.batchSize,
    batchDelayMs: options?.delayMs,
    logContext: { broadcastId },

    async loadBatch(_offset, limit) {
      const rows = await db
        .select()
        .from(broadcastRecipients)
        .where(
          and(
            eq(broadcastRecipients.broadcastId, broadcastId),
            eq(broadcastRecipients.status, 'queued'),
          ),
        )
        .limit(limit);

      return rows.map<SendRecipient>((r) => ({
        id: r.id,
        phone: r.phone,
        templateName: broadcast.templateName,
        templateLanguage: broadcast.templateLanguage,
        variables: (r.variables ?? {}) as Record<string, string>,
      }));
    },

    async updateRecipient(recipient, result) {
      if (result.success) {
        await db
          .update(broadcastRecipients)
          .set({
            status: 'sent',
            externalMessageId: result.messageId ?? null,
            sentAt: new Date(),
          })
          .where(eq(broadcastRecipients.id, recipient.id));
      } else {
        await db
          .update(broadcastRecipients)
          .set({
            status: 'failed',
            failureReason: result.error ?? 'Send failed',
          })
          .where(eq(broadcastRecipients.id, recipient.id));
      }
    },

    async updateCounters(delta: CounterDelta) {
      await db
        .update(broadcasts)
        .set({
          sentCount: sql`${broadcasts.sentCount} + ${delta.sent}`,
          failedCount: sql`${broadcasts.failedCount} + ${delta.failed}`,
        })
        .where(eq(broadcasts.id, broadcastId));
    },

    async checkHalt(): Promise<HaltReason | null> {
      const [current] = await db
        .select({ status: broadcasts.status })
        .from(broadcasts)
        .where(eq(broadcasts.id, broadcastId));
      if (current?.status === 'cancelled') return 'cancelled';
      if (current?.status === 'paused') return 'paused';
      return null;
    },

    async onBatchComplete(_stats: BatchStats) {
      await realtime
        .notify({ table: 'broadcasts', id: broadcastId, action: 'update' })
        .catch(() => {});
    },

    async onCircuitOpen() {
      await db
        .update(broadcasts)
        .set({ status: 'paused' })
        .where(eq(broadcasts.id, broadcastId));

      await scheduler.add(
        'broadcast:execute',
        { broadcastId },
        { startAfter: new Date(Date.now() + 60_000).toISOString() },
      );
    },

    async onFinalize(outcome: FinalOutcome) {
      // Halted-cancelled broadcasts already carry status='cancelled' — leave them alone.
      if (outcome === 'cancelled') return;

      const [finalCounts] = await db
        .select({
          sentCount: broadcasts.sentCount,
          failedCount: broadcasts.failedCount,
          totalRecipients: broadcasts.totalRecipients,
        })
        .from(broadcasts)
        .where(eq(broadcasts.id, broadcastId));

      const completedAt = new Date();
      const allFailed =
        finalCounts &&
        finalCounts.sentCount === 0 &&
        finalCounts.failedCount > 0;

      await db
        .update(broadcasts)
        .set({
          status: allFailed ? 'failed' : 'completed',
          completedAt,
        })
        .where(eq(broadcasts.id, broadcastId));

      await realtime
        .notify({ table: 'broadcasts', id: broadcastId, action: 'update' })
        .catch(() => {});

      logger.info('[broadcast] Broadcast execution finished', {
        broadcastId,
        status: allFailed ? 'failed' : 'completed',
        sent: finalCounts?.sentCount ?? 0,
        failed: finalCounts?.failedCount ?? 0,
      });
    },
  });
}
