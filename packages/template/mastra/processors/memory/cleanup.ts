import type { VobaseDb } from '@vobase/core';
import { eq, inArray } from 'drizzle-orm';

import {
  aiMemCells,
  aiMemEpisodes,
  aiMemEventLogs,
} from '../../../modules/ai/schema';

/**
 * Clean up all memory data for a thread.
 * Called by messaging's thread delete handler.
 */
export async function cleanupThreadMemory(
  db: VobaseDb,
  threadId: string,
): Promise<void> {
  const cells = await db
    .select({ id: aiMemCells.id })
    .from(aiMemCells)
    .where(eq(aiMemCells.threadId, threadId));

  if (cells.length === 0) return;

  const cellIds = cells.map((c) => c.id);

  await db
    .delete(aiMemEventLogs)
    .where(inArray(aiMemEventLogs.cellId, cellIds));
  await db.delete(aiMemEpisodes).where(inArray(aiMemEpisodes.cellId, cellIds));
  await db.delete(aiMemCells).where(eq(aiMemCells.threadId, threadId));
}
