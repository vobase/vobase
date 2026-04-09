import type {
  ChannelsService,
  OutboundMessage,
  Scheduler,
  SendResult,
  VobaseDb,
} from '@vobase/core';
import { CircuitBreaker, logger } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { channelInstances, contacts, interactions, messages } from '../schema';
import { checkWindow } from './channel-sessions';
import { getModuleDeps } from './deps';

// ─── Circuit Breaker (per channel type, in-memory) ─────────────────

const circuitBreakers = new Map<string, CircuitBreaker>();

function getCircuit(channelType: string): CircuitBreaker {
  let cb = circuitBreakers.get(channelType);
  if (!cb) {
    cb = new CircuitBreaker({ threshold: 5, resetTimeout: 60_000 });
    circuitBreakers.set(channelType, cb);
  }
  return cb;
}

export function isCircuitOpen(channelType: string): boolean {
  return getCircuit(channelType).isOpen();
}

export function recordCircuitSuccess(channelType: string): void {
  getCircuit(channelType).recordSuccess();
}

export function recordCircuitFailure(channelType: string): void {
  getCircuit(channelType).recordFailure();
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
    await markFailed(
      db,
      messageId,
      'No channel type on message',
      message.interactionId,
    );
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

  // Load interaction + contact
  const [interaction] = await db
    .select()
    .from(interactions)
    .where(eq(interactions.id, message.interactionId));

  if (!interaction) {
    await markFailed(
      db,
      messageId,
      'Interaction not found',
      message.interactionId,
    );
    return;
  }

  try {
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, interaction.contactId));

    if (!contact) {
      await markFailed(
        db,
        messageId,
        'Contact not found',
        message.interactionId,
      );
      return;
    }

    // Resolve adapter for this channel type
    const [instance] = interaction.channelInstanceId
      ? await db
          .select({ type: channelInstances.type })
          .from(channelInstances)
          .where(eq(channelInstances.id, interaction.channelInstanceId))
      : [];
    const resolvedType = instance?.type ?? channelType;
    const adapter = channels.getAdapter(resolvedType);
    const channelSend = channels.get(resolvedType);

    let result: SendResult;
    const payload = (message.contentData ?? {}) as Record<string, unknown>;

    // Check messaging window before sending (e.g. WhatsApp 24h window)
    if (adapter?.capabilities?.messagingWindow) {
      const windowStatus = await checkWindow(db, message.interactionId);
      // Only block if a session exists and is expired (no session = no window tracking yet)
      if (windowStatus.expiresAt !== null && !windowStatus.isOpen) {
        await markFailed(
          db,
          messageId,
          'Messaging window expired — cannot send outside the 24h window',
          message.interactionId,
        );
        logger.info('[delivery] window_expired', {
          messageId,
          interactionId: message.interactionId,
          channelType,
        });
        return;
      }
    }

    // Resolve contact address using adapter's contactIdentifierField
    const identifierField =
      adapter?.contactIdentifierField ?? resolveIdentifierField(resolvedType);
    const recipientAddress = contact[identifierField] as string | null;

    if (!adapter || !channelSend) {
      // Web channel or unregistered adapter — no outbound send needed
      result = { success: true };
    } else if (!recipientAddress) {
      await markFailed(
        db,
        messageId,
        `Contact has no ${identifierField} for ${resolvedType} channel`,
        message.interactionId,
      );
      return;
    } else if (adapter.serializeOutbound) {
      // Adapter-driven serialization
      const outbound = adapter.serializeOutbound({
        content: message.content,
        contentData: payload,
      });
      outbound.to = recipientAddress;
      result = await channelSend.send(outbound);
    } else {
      // Fallback: build OutboundMessage from content + payload
      const outbound: OutboundMessage = {
        to: recipientAddress,
        text: message.content,
      };

      if (adapter.renderContent && message.content) {
        outbound.text = adapter.renderContent(message.content);
      }

      if (payload.template) {
        outbound.template = payload.template as OutboundMessage['template'];
        outbound.text = undefined;
      } else if (payload.interactive) {
        outbound.metadata = { interactive: payload.interactive };
      } else if (payload.media) {
        const media = payload.media as {
          type: string;
          url: string;
          caption?: string;
          filename?: string;
        };
        outbound.media = [
          {
            type: media.type as 'image' | 'document' | 'audio' | 'video',
            url: media.url,
            caption: media.caption,
            filename: media.filename,
          },
        ];
      }

      // Email-specific fields
      if (identifierField === 'email') {
        outbound.subject = (payload.subject as string) ?? 'Message';
        outbound.html = outbound.text ? `<p>${outbound.text}</p>` : undefined;
        if (Array.isArray(payload.cc) && payload.cc.length > 0) {
          outbound.metadata = { ...outbound.metadata, cc: payload.cc };
        }
      }

      // Reply-to threading: look up the referenced message's external ID
      if (message.replyToMessageId) {
        const [referencedMsg] = await db
          .select({ externalMessageId: messages.externalMessageId })
          .from(messages)
          .where(eq(messages.id, message.replyToMessageId));
        if (referencedMsg?.externalMessageId) {
          outbound.metadata = {
            ...outbound.metadata,
            replyToMessageId: referencedMsg.externalMessageId,
          };
        }
      }

      result = await channelSend.send(outbound);
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
        .notify({
          table: 'interactions-messages',
          id: message.interactionId,
          action: 'update',
        })
        .catch(() => {});

      logger.info('[delivery] send', {
        messageId,
        interactionId: message.interactionId,
        channelType,
        durationMs: Date.now() - start,
        outcome: 'sent',
      });
    } else {
      const reason =
        [result.code, result.error].filter(Boolean).join(': ') || 'Send failed';

      if (result.retryable === false) {
        await markFailed(db, messageId, reason, message.interactionId);
      } else {
        recordCircuitFailure(channelType);
        await retryOrFail(db, scheduler, message, reason);
      }

      logger.info('[delivery] send', {
        messageId,
        interactionId: message.interactionId,
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

// ─── Identifier Resolution ────────────────────────────────────────

/** Default contact identifier field when adapter doesn't specify one. */
export function resolveIdentifierField(
  channelType: string,
): 'phone' | 'email' | 'identifier' {
  switch (channelType) {
    case 'whatsapp':
      return 'phone';
    case 'email':
    case 'resend':
    case 'smtp':
      return 'email';
    default:
      return 'identifier';
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
    await markFailed(db, message.id, error, message.interactionId);
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
    await scheduler.add(
      'ai:deliver-message',
      { messageId: message.id },
      {
        startAfter: startAfter.toISOString(),
      },
    );
  } catch {
    await markFailed(db, message.id, error, message.interactionId);
  }
}

async function markFailed(
  db: VobaseDb,
  messageId: string,
  reason: string,
  interactionId?: string,
): Promise<void> {
  await db
    .update(messages)
    .set({ status: 'failed', failureReason: reason })
    .where(eq(messages.id, messageId));

  if (interactionId) {
    const { realtime } = getModuleDeps();
    await realtime
      .notify({
        table: 'interactions-messages',
        id: interactionId,
        action: 'update',
      })
      .catch(() => {});
  }

  logger.warn('[delivery] message_failed', { messageId, reason });
}
