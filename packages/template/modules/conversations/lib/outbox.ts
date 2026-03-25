/**
 * Outbox — outbound message delivery tracking.
 *
 * Messages are queued, then sent via core _channels, with status tracking.
 */
import type { ChannelsService, Scheduler, VobaseDb } from '@vobase/core';
import { logger } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { outbox, sessions } from '../schema';

interface EnqueueInput {
  sessionId: string;
  content: string;
  channel: string;
  payload?: {
    template?: { name: string; language: string; parameters?: string[] };
    interactive?: Record<string, unknown>;
  };
}

/** Enqueue an outbound message for delivery. */
export async function enqueueMessage(
  db: VobaseDb,
  scheduler: Scheduler,
  input: EnqueueInput,
): Promise<typeof outbox.$inferSelect> {
  const [record] = await db
    .insert(outbox)
    .values({
      sessionId: input.sessionId,
      content: input.content,
      channel: input.channel,
      payload: input.payload ?? null,
      status: 'queued',
    })
    .returning();

  await scheduler.add('conversations:send', { outboxId: record.id });

  return record;
}

/** Process a queued outbox message — send via channels, update status. */
export async function processOutboxMessage(
  db: VobaseDb,
  channels: ChannelsService,
  outboxId: string,
): Promise<void> {
  const [record] = await db
    .select()
    .from(outbox)
    .where(eq(outbox.id, outboxId));

  if (!record || record.status !== 'queued') return;

  // Load session to get contact info for routing
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, record.sessionId));

  if (!session) {
    await db
      .update(outbox)
      .set({ status: 'failed' })
      .where(eq(outbox.id, outboxId));
    return;
  }

  try {
    // Resolve recipient from session metadata or contact
    const { contacts } = await import('../../contacts/schema');
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, session.contactId));

    if (!contact) {
      await db
        .update(outbox)
        .set({ status: 'failed' })
        .where(eq(outbox.id, outboxId));
      return;
    }

    let result: { success: boolean; messageId?: string };

    if (record.channel === 'whatsapp' && contact.phone) {
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
    } else if (record.channel === 'email' && contact.email) {
      result = await channels.email.send({
        to: contact.email,
        subject: 'Message',
        html: `<p>${record.content}</p>`,
      });
    } else {
      // Web channel — no outbound send needed, messages are delivered via streaming
      result = { success: true };
    }

    await db
      .update(outbox)
      .set({
        status: result.success ? 'sent' : 'failed',
        externalMessageId: result.messageId ?? null,
      })
      .where(eq(outbox.id, outboxId));
  } catch (err) {
    logger.error('[conversations] Failed to send outbox message', {
      outboxId,
      error: err,
    });

    await db
      .update(outbox)
      .set({
        status: 'failed',
        retryCount: (record.retryCount ?? 0) + 1,
      })
      .where(eq(outbox.id, outboxId));
  }
}

/** Update outbox record based on external delivery status callback. */
export async function handleDeliveryStatus(
  db: VobaseDb,
  externalMessageId: string,
  status: 'delivered' | 'read' | 'failed',
): Promise<void> {
  await db
    .update(outbox)
    .set({ status })
    .where(eq(outbox.externalMessageId, externalMessageId));
}
