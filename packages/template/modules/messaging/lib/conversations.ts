import type { VobaseDb } from '@vobase/core';
import { and, eq, isNull, type SQL } from 'drizzle-orm';

import { msgConversations } from '../schema';

/**
 * Find an active (non-archived) conversation for a contact, or create a new one.
 * When inboxId is provided, matches on contactId + inboxId (inbox-aware).
 * When inboxId is null, matches on contactId + channel (legacy behavior).
 */
export async function findOrCreateConversation(
  db: VobaseDb,
  contactId: string,
  channel: string,
  agentId: string,
  inboxId?: string,
) {
  // Build match conditions: contactId + (inboxId or channel) + non-archived
  const conditions: SQL[] = [
    eq(msgConversations.contactId, contactId),
    isNull(msgConversations.archivedAt),
  ];

  if (inboxId) {
    conditions.push(eq(msgConversations.inboxId, inboxId));
  } else {
    conditions.push(eq(msgConversations.channel, channel));
  }

  const existing = (
    await db
      .select()
      .from(msgConversations)
      .where(and(...conditions))
  )[0];

  if (existing) {
    return existing;
  }

  // Create new conversation
  const [conversation] = await db
    .insert(msgConversations)
    .values({
      contactId,
      channel,
      agentId,
      inboxId: inboxId ?? null,
      status: 'open',
      handler: 'ai',
    })
    .returning();

  return conversation;
}
