import type { Scheduler, VobaseDb } from '@vobase/core';

import { msgOutbox } from '../schema';

/**
 * Queue an outbound message for delivery via channel.
 * 1. Insert into msg_outbox with status='queued'
 * 2. Queue pg-boss job for actual send
 *
 * Conversation content is also persisted in Mastra Memory by the agent's
 * OutputProcessor. The outbox only tracks delivery lifecycle.
 */
export async function queueOutboundMessage(
  db: VobaseDb,
  scheduler: Scheduler,
  conversationId: string,
  content: string,
  channel: string,
) {
  const [outboxRow] = await db
    .insert(msgOutbox)
    .values({
      conversationId,
      content,
      channel,
      status: 'queued',
    })
    .returning();

  await scheduler.add(
    'messaging:send',
    { messageId: outboxRow.id, channel },
    { retryLimit: 3 },
  );
}
