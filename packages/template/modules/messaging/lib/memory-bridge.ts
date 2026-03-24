/**
 * Bridge between messaging module and Mastra Memory.
 * Provides helpers for saving/reading messages via the Memory API.
 */
import { getMemory } from '../../../mastra';

/**
 * Save a user/contact message to Mastra Memory.
 * Called by the channel handler for inbound messages (not handled by agent processors).
 */
export async function saveInboundMessage(opts: {
  threadId: string;
  resourceId: string;
  content: string;
  role?: 'user' | 'assistant';
}) {
  const memory = getMemory();

  // Ensure Mastra Memory thread exists (idempotent)
  const existingThread = await memory.getThreadById({
    threadId: opts.threadId,
  });
  if (!existingThread) {
    await memory.saveThread({
      thread: {
        id: opts.threadId,
        resourceId: opts.resourceId,
        title: '',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  await memory.saveMessages({
    messages: [
      {
        id: crypto.randomUUID(),
        threadId: opts.threadId,
        resourceId: opts.resourceId,
        role: opts.role ?? 'user',
        content: {
          format: 2,
          parts: [{ type: 'text' as const, text: opts.content }],
        } as any,
        createdAt: new Date(),
        type: 'text',
      },
    ],
  });
}

/**
 * Create a Mastra Memory thread alongside a Drizzle conversation.
 * Uses the same conversation ID for correlation.
 */
export async function createMemoryThread(opts: {
  threadId: string;
  resourceId: string;
  title?: string;
}) {
  const memory = getMemory();
  await memory.saveThread({
    thread: {
      id: opts.threadId,
      resourceId: opts.resourceId,
      title: opts.title ?? '',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/**
 * Delete a Mastra Memory thread (cleanup on conversation delete).
 */
export async function deleteMemoryThread(threadId: string) {
  try {
    const memory = getMemory();
    await memory.deleteThread(threadId);
  } catch {
    // Memory not initialized or thread doesn't exist — non-fatal
  }
}

/**
 * Load messages from Mastra Memory for a conversation.
 */
export async function loadConversationMessages(threadId: string) {
  const memory = getMemory();
  const result = await memory.recall({
    threadId,
  });
  return result.messages ?? [];
}
