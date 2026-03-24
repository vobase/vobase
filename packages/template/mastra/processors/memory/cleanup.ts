import type { VobaseDb } from '@vobase/core';
import { eq, inArray } from 'drizzle-orm';

import {
  aiMemCells,
  aiMemEpisodes,
  aiMemEventLogs,
} from '../../../modules/ai/schema';

/**
 * Clean up all memory data for a conversation.
 * Called by messaging's conversation delete handler.
 */
export async function cleanupConversationMemory(
  db: VobaseDb,
  conversationId: string,
): Promise<void> {
  const cells = await db
    .select({ id: aiMemCells.id })
    .from(aiMemCells)
    .where(eq(aiMemCells.threadId, conversationId));

  if (cells.length === 0) return;

  const cellIds = cells.map((c) => c.id);

  await db
    .delete(aiMemEventLogs)
    .where(inArray(aiMemEventLogs.cellId, cellIds));
  await db.delete(aiMemEpisodes).where(inArray(aiMemEpisodes.cellId, cellIds));
  await db.delete(aiMemCells).where(eq(aiMemCells.threadId, conversationId));
}
