import type { VobaseDb } from '@vobase/core';
import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm';

import { embedChunks } from '../../../../lib/embeddings';
import { msgMessages } from '../../../messaging/schema';
import { aiMemCells, aiMemEpisodes, aiMemEventLogs } from '../../schema';
import { extractEpisode, extractEventLogs } from './extractors';
import type { MemoryMessage } from './types';

/**
 * Process a MemCell: extract episode + event logs, embed, write to DB.
 * Called by the memory-formation job. Marks cell status through lifecycle.
 */
export async function processMemCell(
  db: VobaseDb,
  cellId: string,
): Promise<void> {
  // 1. Atomic claim: set status to 'processing' only if still 'pending'.
  // Single UPDATE eliminates the TOCTOU race — no separate SELECT needed.
  const [claimed] = await db
    .update(aiMemCells)
    .set({ status: 'processing' })
    .where(and(eq(aiMemCells.id, cellId), eq(aiMemCells.status, 'pending')))
    .returning();

  if (!claimed) return; // Not found or already claimed by another worker
  const cell = claimed;

  // Check if another cell for this thread is already processing.
  // If so, release this cell back to pending — pg-boss will retry later.
  const [otherProcessing] = await db
    .select({ id: aiMemCells.id })
    .from(aiMemCells)
    .where(
      and(
        eq(aiMemCells.threadId, cell.threadId),
        eq(aiMemCells.status, 'processing'),
        ne(aiMemCells.id, cellId),
      ),
    )
    .limit(1);

  if (otherProcessing) {
    await db
      .update(aiMemCells)
      .set({ status: 'pending' })
      .where(eq(aiMemCells.id, cellId));
    throw new Error('Another cell is processing for this thread — retry later');
  }

  try {
    // 2. Load source messages for this cell's range
    const messages = await loadCellMessages(db, cell);
    if (messages.length === 0) {
      await db
        .update(aiMemCells)
        .set({ status: 'error', errorMessage: 'No messages found in range' })
        .where(eq(aiMemCells.id, cellId));
      return;
    }

    // 3. Extract episode and event logs in parallel
    const [episode, eventLogs] = await Promise.all([
      extractEpisode({ messages }),
      extractEventLogs({ messages }),
    ]);

    // 4. Embed all texts
    const textsToEmbed = [
      `${episode.title} ${episode.content}`,
      ...eventLogs.map((e) => e.fact),
    ];
    const embeddings = await embedChunks(textsToEmbed);
    const [episodeEmbedding, ...factEmbeddings] = embeddings;

    // 5. Write to DB in a transaction
    await db.transaction(async (tx) => {
      // Insert episode
      await tx.insert(aiMemEpisodes).values({
        cellId,
        contactId: cell.contactId,
        userId: cell.userId,
        title: episode.title,
        content: episode.content,
        embedding: episodeEmbedding,
      });

      // Insert event logs
      if (eventLogs.length > 0) {
        await tx.insert(aiMemEventLogs).values(
          eventLogs.map((entry, i) => ({
            cellId,
            contactId: cell.contactId,
            userId: cell.userId,
            fact: entry.fact,
            subject: entry.subject ?? null,
            occurredAt: entry.occurredAt ? new Date(entry.occurredAt) : null,
            embedding: factEmbeddings[i],
          })),
        );
      }

      // Mark cell as ready
      await tx
        .update(aiMemCells)
        .set({ status: 'ready' })
        .where(eq(aiMemCells.id, cellId));
    });
  } catch (err) {
    // Mark cell as error — pg-boss will retry the job
    const message =
      err instanceof Error ? err.message : 'Unknown formation error';
    await db
      .update(aiMemCells)
      .set({ status: 'error', errorMessage: message })
      .where(eq(aiMemCells.id, cellId));
    throw err; // Re-throw so pg-boss knows to retry
  }
}

/**
 * Load messages belonging to a MemCell's range.
 * Uses the thread's messages ordered by creation, filtered between start and end message IDs.
 */
async function loadCellMessages(
  db: VobaseDb,
  cell: typeof aiMemCells.$inferSelect,
): Promise<MemoryMessage[]> {
  // Get the start and end message timestamps for range query
  const boundaryMessages = await db
    .select({
      id: msgMessages.id,
      createdAt: msgMessages.createdAt,
    })
    .from(msgMessages)
    .where(inArray(msgMessages.id, [cell.startMessageId, cell.endMessageId]));

  if (boundaryMessages.length < 2) return [];

  const startMsg = boundaryMessages.find((m) => m.id === cell.startMessageId);
  const endMsg = boundaryMessages.find((m) => m.id === cell.endMessageId);
  if (!startMsg || !endMsg) return [];

  // Fetch messages in the time range for this thread
  const rows = await db
    .select({
      id: msgMessages.id,
      content: msgMessages.content,
      aiRole: msgMessages.aiRole,
      createdAt: msgMessages.createdAt,
    })
    .from(msgMessages)
    .where(
      and(
        eq(msgMessages.threadId, cell.threadId),
        gte(msgMessages.createdAt, startMsg.createdAt),
        lte(msgMessages.createdAt, endMsg.createdAt),
      ),
    )
    .orderBy(msgMessages.createdAt);

  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    aiRole: r.aiRole,
    createdAt: r.createdAt,
  }));
}
