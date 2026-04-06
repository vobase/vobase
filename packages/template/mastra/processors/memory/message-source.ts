/**
 * Message source abstraction for EverMemOS.
 * Loads messages directly from the `messages` table (conversations pgSchema).
 * Used by formation.ts, retriever.ts, and memory-processor.ts.
 */
import type { VobaseDb } from '@vobase/core';
import { and, asc, eq, gte, lte, ne } from 'drizzle-orm';

import { messages } from '../../../modules/ai/schema';
import type { MemoryMessage } from './types';

function toMemoryMessage(row: typeof messages.$inferSelect): MemoryMessage {
  const aiRole =
    row.senderType === 'contact'
      ? 'user'
      : row.senderType === 'agent'
        ? 'assistant'
        : row.senderType === 'user'
          ? 'assistant' // staff messages are on the business side
          : 'system';

  return {
    id: row.id,
    content: row.content,
    aiRole,
    createdAt: row.createdAt,
  };
}

/**
 * Load all non-withdrawn, non-activity messages for a conversation, oldest first.
 */
export async function loadMessagesForConversation(
  db: VobaseDb,
  threadId: string,
): Promise<MemoryMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, threadId),
        eq(messages.withdrawn, false),
        eq(messages.private, false),
        ne(messages.messageType, 'activity'),
      ),
    )
    .orderBy(asc(messages.createdAt));

  return rows.map(toMemoryMessage);
}

/**
 * Load messages in a time range (for MemCell formation).
 * Resolves timestamps from start/end message IDs, then queries the range.
 */
export async function loadMessagesInRange(
  db: VobaseDb,
  threadId: string,
  startMessageId: string,
  endMessageId: string,
): Promise<MemoryMessage[]> {
  const [[startMsg], [endMsg]] = await Promise.all([
    db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.id, startMessageId)),
    db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.id, endMessageId)),
  ]);

  if (!startMsg || !endMsg) return [];

  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, threadId),
        eq(messages.withdrawn, false),
        eq(messages.private, false),
        ne(messages.messageType, 'activity'),
        gte(messages.createdAt, startMsg.createdAt),
        lte(messages.createdAt, endMsg.createdAt),
      ),
    )
    .orderBy(asc(messages.createdAt));

  return rows.map(toMemoryMessage);
}
