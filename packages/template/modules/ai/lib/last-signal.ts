import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { conversations } from '../schema';

/**
 * Update the denormalized last-signal pointer on a conversation.
 * Stores kind ('message' | 'activity') and the record ID.
 * The mine/queue handlers join the actual content at read time.
 */
export async function updateLastSignal(
  db: VobaseDb,
  conversationId: string,
  kind: 'message' | 'activity',
  id: string,
) {
  await db
    .update(conversations)
    .set({ lastSignalKind: kind, lastSignalId: id })
    .where(eq(conversations.id, conversationId));
}
