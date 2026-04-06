import type {
  ChannelsService,
  Scheduler,
  SendResult,
  VobaseDb,
} from '@vobase/core';
import { logger } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { contacts, conversations, messages } from '../schema';
import { getModuleDeps } from './deps';

// ─── Circuit Breaker (in-memory, single-instance) ──────────────────

interface CircuitState {
  failures: number;
  openAt: number | null;
}

const circuitBreakers = new Map<string, CircuitState>();
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 60_000;

export function isCircuitOpen(channelType: string): boolean {
  const state = circuitBreakers.get(channelType);
  if (!state || state.openAt === null) return false;
  if (Date.now() - state.openAt >= CIRCUIT_OPEN_MS) {
    state.openAt = null;
    return false;
  }
  return true;
}

export function recordCircuitSuccess(channelType: string): void {
  circuitBreakers.set(channelType, { failures: 0, openAt: null });
}

export function recordCircuitFailure(channelType: string): void {
  const state = circuitBreakers.get(channelType) ?? {
    failures: 0,
    openAt: null,
  };
  state.failures += 1;
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD && state.openAt === null) {
    state.openAt = Date.now();
    logger.warn('[delivery] circuit_open', {
      channelType,
      failures: state.failures,
    });
  }
  circuitBreakers.set(channelType, state);
}

export function resetCircuit(channelType: string): void {
  circuitBreakers.delete(channelType);
}

// ─── Delivery Queue ────────────────────────────────────────────────

const MAX_RETRIES = 5;

export async function enqueueDelivery(
  scheduler: Scheduler,
  messageId: string,
): Promise<void> {
  await scheduler.add('ai:deliver-message', { messageId });
}

export async function processDelivery(
  db: VobaseDb,
  channels: ChannelsService,
  scheduler: Scheduler,
  messageId: string,
): Promise<void> {
  const start = Date.now();

  const [message] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId));

  if (!message || message.status !== 'queued') return;

  const channelType = message.channelType;
  if (!channelType) {
    await markFailed(db, messageId, 'No channel type on message', message.conversationId);
    return;
  }

  // Check circuit breaker
  if (isCircuitOpen(channelType)) {
    logger.warn('[delivery] circuit_skip', { messageId, channelType });
    await retryOrFail(
      db,
      scheduler,
      message,
      'Circuit open — channel unavailable',
    );
    return;
  }

  // Load conversation + contact
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, message.conversationId));

  if (!conversation) {
    await markFailed(db, messageId, 'Conversation not found', message.conversationId);
    return;
  }

  try {
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, conversation.contactId));

    if (!contact) {
      await markFailed(db, messageId, 'Contact not found', message.conversationId);
      return;
    }

    let result: SendResult;
    const payload = (message.contentData ?? {}) as Record<string, unknown>;

    if (channelType === 'whatsapp' && contact.phone) {
      if (payload.template) {
        result = await channels.whatsapp.send({
          to: contact.phone,
          template: payload.template as {
            name: string;
            language: string;
            parameters?: string[];
          },
        });
      } else if (payload.interactive) {
        result = await channels.whatsapp.send({
          to: contact.phone,
          text: message.content,
          metadata: { interactive: payload.interactive },
        });
      } else if (payload.media) {
        const media = payload.media as {
          type: string;
          url: string;
          caption?: string;
          filename?: string;
        };
        result = await channels.whatsapp.send({
          to: contact.phone,
          text: message.content,
          media: [
            {
              type: media.type as 'image' | 'document' | 'audio' | 'video',
              url: media.url,
              caption: media.caption,
              filename: media.filename,
            },
          ],
        });
      } else {
        result = await channels.whatsapp.send({
          to: contact.phone,
          text: message.content,
        });
      }
    } else if (channelType === 'email' && contact.email) {
      result = await channels.email.send({
        to: contact.email,
        subject: 'Message',
        html: `<p>${message.content}</p>`,
      });
    } else {
      // Web channel — no outbound send needed
      result = { success: true };
    }

    if (result.success) {
      recordCircuitSuccess(channelType);
      await db
        .update(messages)
        .set({
          status: 'sent',
          externalMessageId: result.messageId ?? null,
        })
        .where(eq(messages.id, messageId));

      const { realtime } = getModuleDeps();
      await realtime
        .notify({ table: 'conversations-messages', id: message.conversationId, action: 'update' })
        .catch(() => {});

      logger.info('[delivery] send', {
        messageId,
        conversationId: message.conversationId,
        channelType,
        durationMs: Date.now() - start,
        outcome: 'sent',
      });
    } else {
      const reason = [result.code, result.error]
        .filter(Boolean)
        .join(': ') || 'Send failed';

      if (result.retryable === false) {
        await markFailed(db, messageId, reason, message.conversationId);
      } else {
        recordCircuitFailure(channelType);
        await retryOrFail(db, scheduler, message, reason);
      }

      logger.info('[delivery] send', {
        messageId,
        conversationId: message.conversationId,
        channelType,
        durationMs: Date.now() - start,
        outcome: 'failed',
        error: reason,
      });
    }
  } catch (err) {
    recordCircuitFailure(channelType);
    const errMsg =
      err instanceof Error
        ? `${err.name}: ${err.message}`
        : typeof err === 'string'
          ? err
          : JSON.stringify(err) || 'Unknown delivery error';
    logger.error('[delivery] send_error', {
      messageId,
      error: errMsg,
    });
    await retryOrFail(db, scheduler, message, errMsg);
  }
}

// ─── Retry / Fail Helpers ──────────────────────────────────────────

async function retryOrFail(
  db: VobaseDb,
  scheduler: Scheduler,
  message: typeof messages.$inferSelect,
  error: string,
): Promise<void> {
  const attempt = (message.retryCount ?? 0) + 1;

  if (attempt >= MAX_RETRIES) {
    await markFailed(db, message.id, error, message.conversationId);
    return;
  }

  // Exponential backoff: 4s, 8s, 16s, 32s ...
  const backoffMs = 2 ** (attempt + 1) * 1000;
  const startAfter = new Date(Date.now() + backoffMs);

  await db
    .update(messages)
    .set({ retryCount: attempt })
    .where(eq(messages.id, message.id));

  try {
    await scheduler.add('ai:deliver-message', { messageId: message.id }, {
      startAfter: startAfter.toISOString(),
    });
  } catch {
    await markFailed(db, message.id, error, message.conversationId);
  }
}

async function markFailed(
  db: VobaseDb,
  messageId: string,
  reason: string,
  conversationId?: string,
): Promise<void> {
  await db
    .update(messages)
    .set({ status: 'failed', failureReason: reason })
    .where(eq(messages.id, messageId));

  if (conversationId) {
    const { realtime } = getModuleDeps();
    await realtime
      .notify({ table: 'conversations-messages', id: conversationId, action: 'update' })
      .catch(() => {});
  }

  logger.warn('[delivery] message_failed', { messageId, reason });
}
