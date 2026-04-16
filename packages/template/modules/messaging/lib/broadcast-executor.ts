import type { OutboundMessage } from '@vobase/core';
import { logger } from '@vobase/core';
import { and, eq, sql } from 'drizzle-orm';

import { broadcastRecipients, broadcasts, channelInstances } from '../schema';
import {
  isCircuitOpen,
  recordCircuitFailure,
  recordCircuitSuccess,
} from './delivery';
import { getModuleDeps } from './deps';

// ─── WhatsApp Error Translation ────────────────────────────────────

export function translateWhatsAppError(code: string): string {
  switch (code) {
    case '131026':
      return 'Invalid phone number';
    case '130429':
      return 'Rate limited';
    case '131047':
      return 'Message undeliverable';
    case '131051':
      return 'Unsupported message type';
    case '131056':
      return 'Rate limited (pair rate)';
    case '132000':
      return 'Template not found';
    case '132012':
      return 'Template parameter mismatch';
    default:
      return `WhatsApp error: ${code}`;
  }
}

// ─── Broadcast Executor ────────────────────────────────────────────

export async function executeBroadcast(
  broadcastId: string,
  options?: { batchSize?: number; delayMs?: number },
): Promise<void> {
  const batchSize = options?.batchSize ?? 50;
  const delayMs = options?.delayMs ?? 100;

  const deps = getModuleDeps();
  const { db, scheduler, channels, realtime } = deps;

  // 1. Load broadcast and verify status is 'sending'
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

  // 2. Load channel instance and resolve adapter
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

  // 3. Process recipients in batches (WHERE status='queued' is self-advancing)
  while (true) {
    // Check circuit breaker before each batch
    if (isCircuitOpen('whatsapp')) {
      logger.warn('[broadcast] Circuit open — pausing broadcast', {
        broadcastId,
      });

      await db
        .update(broadcasts)
        .set({ status: 'paused' })
        .where(eq(broadcasts.id, broadcastId));

      await scheduler.add(
        'broadcast:execute',
        { broadcastId },
        { startAfter: new Date(Date.now() + 60_000).toISOString() },
      );

      return;
    }

    // Load next batch of queued recipients
    const batch = await db
      .select()
      .from(broadcastRecipients)
      .where(
        and(
          eq(broadcastRecipients.broadcastId, broadcastId),
          eq(broadcastRecipients.status, 'queued'),
        ),
      )
      .limit(batchSize);

    if (batch.length === 0) break;

    let batchSent = 0;
    let batchFailed = 0;

    // Send all messages in the batch concurrently
    const results = await Promise.allSettled(
      batch.map(async (recipient) => {
        const variables = (recipient.variables ?? {}) as Record<string, string>;

        // Variables are stored as { "1": "value", "2": "value" } — sorted by key
        const sortedValues = Object.keys(variables)
          .sort((a, b) => Number(a) - Number(b))
          .map((key) => variables[key]);

        const outbound: OutboundMessage = {
          to: recipient.phone,
          template: {
            name: broadcast.templateName,
            language: broadcast.templateLanguage,
            components:
              sortedValues.length > 0
                ? [
                    {
                      type: 'body',
                      parameters: sortedValues.map((v) => ({
                        type: 'text' as const,
                        text: v,
                      })),
                    },
                  ]
                : [],
          },
        };

        const result = await adapter.send(outbound);

        if (result.success) {
          recordCircuitSuccess('whatsapp');

          await db
            .update(broadcastRecipients)
            .set({
              status: 'sent',
              externalMessageId: result.messageId ?? null,
              sentAt: new Date(),
            })
            .where(eq(broadcastRecipients.id, recipient.id));

          return 'sent' as const;
        } else {
          recordCircuitFailure('whatsapp');

          const failureReason = result.code
            ? translateWhatsAppError(result.code)
            : (result.error ?? 'Send failed');

          await db
            .update(broadcastRecipients)
            .set({
              status: 'failed',
              failureReason,
            })
            .where(eq(broadcastRecipients.id, recipient.id));

          return 'failed' as const;
        }
      }),
    );

    // Tally results
    for (const settled of results) {
      if (settled.status === 'fulfilled') {
        if (settled.value === 'sent') {
          batchSent++;
        } else {
          batchFailed++;
        }
      } else {
        // Promise itself rejected — count as failed
        batchFailed++;
        logger.error('[broadcast] Unexpected send error', {
          broadcastId,
          error: settled.reason,
        });
      }
    }

    // Atomically update broadcast counters
    await db
      .update(broadcasts)
      .set({
        sentCount: sql`${broadcasts.sentCount} + ${batchSent}`,
        failedCount: sql`${broadcasts.failedCount} + ${batchFailed}`,
      })
      .where(eq(broadcasts.id, broadcastId));

    // Notify realtime after each batch
    await realtime
      .notify({ table: 'broadcasts', id: broadcastId, action: 'update' })
      .catch(() => {});

    // Re-check broadcast status before continuing
    const [current] = await db
      .select({ status: broadcasts.status })
      .from(broadcasts)
      .where(eq(broadcasts.id, broadcastId));

    if (current?.status === 'cancelled' || current?.status === 'paused') {
      logger.info('[broadcast] Broadcast stopped mid-run', {
        broadcastId,
        status: current.status,
      });
      return;
    }

    // Delay between batches
    await Bun.sleep(delayMs);
  }

  // 4. Finalize broadcast status
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
    finalCounts && finalCounts.sentCount === 0 && finalCounts.failedCount > 0;

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
}
