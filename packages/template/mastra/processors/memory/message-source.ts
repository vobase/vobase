/**
 * Message source abstraction for EverMemOS.
 * Loads conversation messages from Mastra Memory instead of the removed msgMessages table.
 * Used by formation.ts, retriever.ts, and memory-processor.ts.
 */
import type { VobaseDb } from '@vobase/core';

import type { MemoryMessage } from './types';

interface RecalledMessage {
  id?: string;
  content: { parts?: Array<{ text?: string }> } | string;
  role?: string;
  createdAt?: Date | string;
}

function toMemoryMessage(m: RecalledMessage): MemoryMessage {
  return {
    id: m.id ?? '',
    content:
      typeof m.content === 'string'
        ? m.content
        : (m.content?.parts?.map((p) => p.text ?? '').join('') ?? ''),
    aiRole: m.role ?? 'user',
    createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
  };
}

/**
 * Load messages for a thread from Mastra Memory.
 * Falls back to empty array if Memory is not initialized.
 */
export async function loadMessagesForThread(
  _db: VobaseDb,
  threadId: string,
): Promise<MemoryMessage[]> {
  try {
    const { getMemory } = await import('../../index');
    const memory = getMemory();
    const result = await memory.recall({ threadId });
    return (result.messages ?? []).map((m) =>
      toMemoryMessage(m as unknown as RecalledMessage),
    );
  } catch {
    return [];
  }
}

/**
 * Load messages in a time range (for MemCell formation).
 */
export async function loadMessagesInRange(
  _db: VobaseDb,
  threadId: string,
  startMessageId: string,
  endMessageId: string,
): Promise<MemoryMessage[]> {
  try {
    const { getMemory } = await import('../../index');
    const memory = getMemory();
    const result = await memory.recall({ threadId });
    const messages = result.messages ?? [];

    // Find start/end indices by message ID
    const startIdx = messages.findIndex((m) => m.id === startMessageId);
    const endIdx = messages.findIndex((m) => m.id === endMessageId);

    if (startIdx === -1 || endIdx === -1) return [];

    const slice = messages.slice(
      Math.min(startIdx, endIdx),
      Math.max(startIdx, endIdx) + 1,
    );

    return slice.map((m) => toMemoryMessage(m as unknown as RecalledMessage));
  } catch {
    return [];
  }
}
