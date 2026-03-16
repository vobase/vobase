import type { VobaseDb } from '@vobase/core';
import { and, eq, isNull } from 'drizzle-orm';

import { msgThreads } from '../schema';

/**
 * Find an active (non-archived) thread for a contact+channel, or create a new one.
 * Application-enforced one-active-per-contact-per-channel (not DB constraint).
 */
export async function findOrCreateThread(
  db: VobaseDb,
  contactId: string,
  channel: string,
  agentId: string,
) {
  // Find active non-archived thread for this contact + channel
  const existing = await db
    .select()
    .from(msgThreads)
    .where(
      and(
        eq(msgThreads.contactId, contactId),
        eq(msgThreads.channel, channel),
        isNull(msgThreads.archivedAt),
      ),
    )
    .get();

  if (existing) {
    return existing;
  }

  // Create new thread
  const [thread] = await db
    .insert(msgThreads)
    .values({
      contactId,
      channel,
      agentId,
      status: 'ai',
    })
    .returning();

  return thread;
}
