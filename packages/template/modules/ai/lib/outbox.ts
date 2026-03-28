import type {
  ChannelsService,
  RealtimeService,
  Scheduler,
  VobaseDb,
} from '@vobase/core';
import { logger } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { contacts, conversations, deadLetters, outbox } from '../schema';
import { emitActivityEvent } from './activity-events';

/** @lintignore */
export const MAX_RETRIES = 5;

// OPTIONAL HARDENING: In-memory circuit breaker — single-instance only, lost on restart.
interface CircuitState {
  failures: number;
  openAt: number | null; // timestamp when circuit opened
}

const circuitBreakers = new Map<string, CircuitState>();

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 60_000; // 60s

/** @lintignore */
export function isCircuitOpen(channelType: string): boolean {
  const state = circuitBreakers.get(channelType);
  if (!state || state.openAt === null) return false;
  if (Date.now() - state.openAt >= CIRCUIT_OPEN_MS) {
    // Transition to half-open: allow one probe
    state.openAt = null;
    return false;
  }
  return true;
}

/** @lintignore */
export function recordCircuitSuccess(channelType: string): void {
  circuitBreakers.set(channelType, { failures: 0, openAt: null });
}

/** @lintignore */
export function recordCircuitFailure(channelType: string): void {
  const state = circuitBreakers.get(channelType) ?? {
    failures: 0,
    openAt: null,
  };
  state.failures += 1;
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD && state.openAt === null) {
    state.openAt = Date.now();
    logger.warn('[conversations] outbox_circuit_open', {
      channelType,
      failures: state.failures,
    });
  }
  circuitBreakers.set(channelType, state);
}

/** @lintignore */
export function resetCircuit(channelType: string): void {
  circuitBreakers.delete(channelType);
}

interface EnqueueInput {
  conversationId: string;
  content: string;
  channelType: string;
  channelInstanceId?: string;
  payload?: {
    template?: { name: string; language: string; parameters?: string[] };
    interactive?: Record<string, unknown>;
  };
}

export async function enqueueMessage(
  db: VobaseDb,
  scheduler: Scheduler,
  input: EnqueueInput,
  realtime?: RealtimeService,
): Promise<typeof outbox.$inferSelect> {
  const start = Date.now();

  const [record] = await db
    .insert(outbox)
    .values({
      conversationId: input.conversationId,
      content: input.content,
      channelType: input.channelType,
      channelInstanceId: input.channelInstanceId ?? null,
      payload: input.payload ?? null,
      status: 'queued',
    })
    .returning();

  await scheduler.add('ai:send', { outboxId: record.id });

  // Emit message.outbound_queued activity event (fire-and-forget)
  if (realtime) {
    await emitActivityEvent(db, realtime, {
      type: 'message.outbound_queued',
      source: 'agent',
      conversationId: input.conversationId,
      channelType: input.channelType,
      data: { outboxId: record.id },
    });
  }

  logger.info('[conversations] outbox_enqueue', {
    outboxId: record.id,
    conversationId: input.conversationId,
    channelType: input.channelType,
    durationMs: Date.now() - start,
    outcome: 'queued',
  });

  return record;
}

export async function processOutboxMessage(
  db: VobaseDb,
  channels: ChannelsService,
  scheduler: Scheduler,
  outboxId: string,
): Promise<void> {
  const start = Date.now();

  const [record] = await db
    .select()
    .from(outbox)
    .where(eq(outbox.id, outboxId));

  if (!record || record.status !== 'queued') return;

  // OPTIONAL HARDENING: Check circuit breaker before attempting send
  if (isCircuitOpen(record.channelType)) {
    logger.warn('[conversations] outbox_circuit_skip', {
      outboxId,
      channelType: record.channelType,
    });
    await retryOrDeadLetter(
      db,
      scheduler,
      record,
      'Circuit open — channel unavailable',
    );
    return;
  }

  // Load conversation to get contact info for routing
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, record.conversationId));

  if (!conversation) {
    await moveToDeadLetters(db, record, 'Conversation not found');
    return;
  }

  try {
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, conversation.contactId));

    if (!contact) {
      await moveToDeadLetters(db, record, 'Contact not found');
      return;
    }

    let result: { success: boolean; messageId?: string; error?: string };

    if (record.channelType === 'whatsapp' && contact.phone) {
      const payload = record.payload as {
        template?: { name: string; language: string; parameters?: string[] };
        interactive?: Record<string, unknown>;
      } | null;

      if (payload?.template) {
        result = await channels.whatsapp.send({
          to: contact.phone,
          template: payload.template,
        });
      } else if (payload?.interactive) {
        result = await channels.whatsapp.send({
          to: contact.phone,
          text: record.content,
          metadata: { interactive: payload.interactive },
        });
      } else {
        result = await channels.whatsapp.send({
          to: contact.phone,
          text: record.content,
        });
      }
    } else if (record.channelType === 'email' && contact.email) {
      result = await channels.email.send({
        to: contact.email,
        subject: 'Message',
        html: `<p>${record.content}</p>`,
      });
    } else {
      // Web channel — no outbound send needed, messages are delivered via streaming
      result = { success: true };
    }

    // M5: Warn on inconsistent SendResult
    if (result.success && !result.messageId && record.channelType !== 'web') {
      logger.warn('[conversations] outbox_send_result_no_message_id', {
        outboxId,
        channelType: record.channelType,
      });
    } else if (!result.success && !result.error) {
      logger.warn('[conversations] outbox_send_result_no_error', {
        outboxId,
        channelType: record.channelType,
      });
    }

    if (result.success) {
      recordCircuitSuccess(record.channelType);
      await db
        .update(outbox)
        .set({
          status: 'sent',
          externalMessageId: result.messageId ?? null,
        })
        .where(eq(outbox.id, outboxId));

      logger.info('[conversations] outbox_send', {
        outboxId,
        conversationId: record.conversationId,
        channelType: record.channelType,
        durationMs: Date.now() - start,
        outcome: 'sent',
      });
    } else {
      recordCircuitFailure(record.channelType);
      // Channel returned failure — retry or dead-letter
      await retryOrDeadLetter(
        db,
        scheduler,
        record,
        result.error ?? 'Send failed',
      );

      logger.info('[conversations] outbox_send', {
        outboxId,
        conversationId: record.conversationId,
        channelType: record.channelType,
        durationMs: Date.now() - start,
        outcome: 'failed',
        error: result.error,
      });
    }
  } catch (err) {
    recordCircuitFailure(record.channelType);
    logger.error('[conversations] Failed to send outbox message', {
      outboxId,
      error: err,
    });

    logger.info('[conversations] outbox_send', {
      outboxId,
      conversationId: record.conversationId,
      channelType: record.channelType,
      durationMs: Date.now() - start,
      outcome: 'error',
    });

    await retryOrDeadLetter(
      db,
      scheduler,
      record,
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function retryOrDeadLetter(
  db: VobaseDb,
  scheduler: Scheduler,
  record: typeof outbox.$inferSelect,
  error: string,
): Promise<void> {
  const nextRetry = (record.retryCount ?? 0) + 1;

  if (nextRetry >= MAX_RETRIES) {
    await moveToDeadLetters(db, record, error);
    return;
  }

  // Exponential backoff: 2^retryCount seconds (2s, 4s, 8s, 16s, 32s)
  const backoffMs = 2 ** nextRetry * 1000;
  const startAfter = new Date(Date.now() + backoffMs);

  await db
    .update(outbox)
    .set({ retryCount: nextRetry, status: 'queued' })
    .where(eq(outbox.id, record.id));

  await scheduler.add(
    'ai:send',
    { outboxId: record.id },
    { startAfter: startAfter.toISOString() },
  );

  logger.info('[conversations] Outbox message scheduled for retry', {
    outboxId: record.id,
    retryCount: nextRetry,
    backoffMs,
  });
}

async function moveToDeadLetters(
  db: VobaseDb,
  record: typeof outbox.$inferSelect,
  error: string,
): Promise<void> {
  await db.insert(deadLetters).values({
    originalOutboxId: record.id,
    conversationId: record.conversationId,
    channelType: record.channelType,
    channelInstanceId: record.channelInstanceId,
    content: record.content,
    payload: record.payload,
    error,
    retryCount: record.retryCount ?? 0,
    status: 'dead',
  });

  await db.delete(outbox).where(eq(outbox.id, record.id));

  logger.warn('[conversations] Outbox message moved to dead letters', {
    outboxId: record.id,
    error,
    retryCount: record.retryCount,
  });
}
