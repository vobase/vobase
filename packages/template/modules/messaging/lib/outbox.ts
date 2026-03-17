import type { Scheduler, VobaseDb } from '@vobase/core';

import { msgMessages } from '../schema';

/**
 * Queue an outbound message for delivery via channel.
 * 1. Insert msg_messages with status='queued', direction='outbound', senderType='agent'
 * 2. Queue pg-boss job for actual send
 */
export async function queueOutboundMessage(
  db: VobaseDb,
  scheduler: Scheduler,
  threadId: string,
  content: string,
  channel: string,
) {
  const [message] = await db
    .insert(msgMessages)
    .values({
      threadId,
      direction: 'outbound',
      senderType: 'agent',
      aiRole: 'assistant',
      content,
      status: 'queued',
    })
    .returning();

  await scheduler.add(
    'messaging:send',
    { messageId: message.id, channel },
    { retry: 3 },
  );
}
