import type {
  InputProcessor,
  OutputProcessor,
  ProcessInputArgs,
  ProcessInputResult,
  ProcessOutputResultArgs,
} from '@mastra/core/processors';
import type { Scheduler, VobaseDb } from '@vobase/core';
import { logger } from '@vobase/core';
import { desc, eq } from 'drizzle-orm';

import { aiMemCells } from '../../../modules/ai/schema';
import { computeBufferTokens, detectBoundary } from './boundary-detector';
import { loadMessagesForConversation } from './message-source';
import { retrieveMemory } from './retriever';
import type { MemoryMessage, MemoryScope } from './types';

interface MemoryProcessorContext {
  db: VobaseDb;
  scheduler: Scheduler;
  conversationId: string;
  scope: MemoryScope;
}

/**
 * Mastra InputProcessor: retrieves relevant memory and injects as system messages.
 */
export function createMemoryInputProcessor(
  ctx: Omit<MemoryProcessorContext, 'scheduler'>,
): InputProcessor {
  const { db, conversationId, scope } = ctx;

  return {
    id: 'memory-retriever',

    async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
      try {
        // Extract the latest user message as the retrieval query
        const lastUserMessage = [...args.messages]
          .reverse()
          .find((m) => m.role === 'user');

        if (!lastUserMessage) {
          return {
            messages: args.messages,
            systemMessages: args.systemMessages,
          };
        }

        const queryText =
          typeof lastUserMessage.content === 'string'
            ? lastUserMessage.content
            : Array.isArray(lastUserMessage.content)
              ? lastUserMessage.content
                  // biome-ignore lint/suspicious/noExplicitAny: MastraDBMessage content parts have varying shapes across versions
                  .filter((p: any) => p.type === 'text')
                  // biome-ignore lint/suspicious/noExplicitAny: MastraDBMessage content parts have varying shapes across versions
                  .map((p: any) => p.text)
                  .join(' ')
              : '';

        if (!queryText.trim()) {
          return {
            messages: args.messages,
            systemMessages: args.systemMessages,
          };
        }

        const memory = await retrieveMemory(db, scope, queryText, {
          limit: 5,
        });

        // If no memory, pass through unchanged
        if (memory.episodes.length === 0 && memory.facts.length === 0) {
          return {
            messages: args.messages,
            systemMessages: args.systemMessages,
          };
        }

        // Build memory context string
        const parts: string[] = [];

        if (memory.episodes.length > 0) {
          parts.push('## Relevant conversation history:');
          for (const ep of memory.episodes) {
            parts.push(`**${ep.title}**: ${ep.content}`);
          }
        }

        if (memory.facts.length > 0) {
          parts.push('## Known facts about this contact:');
          for (const f of memory.facts) {
            parts.push(`- ${f.fact}`);
          }
        }

        if (memory.originalMessages.length > 0) {
          parts.push('## Original conversation excerpt:');
          for (const m of memory.originalMessages.slice(0, 10)) {
            parts.push(`[${m.role}]: ${m.content}`);
          }
        }

        const memoryContent = parts.join('\n');

        // Inject memory as a system message
        return {
          messages: args.messages,
          systemMessages: [
            ...args.systemMessages,
            {
              role: 'system' as const,
              content: `[Memory Context]\n${memoryContent}`,
            },
          ],
        };
      } catch (err) {
        logger.error('[memory] Retrieval failed', {
          conversationId,
          error: err,
        });
        return { messages: args.messages, systemMessages: args.systemMessages };
      }
    },
  };
}

/**
 * Mastra OutputProcessor: detects conversation boundaries and queues memory formation.
 */
export function createMemoryOutputProcessor(
  ctx: MemoryProcessorContext,
): OutputProcessor {
  const { db, scheduler, conversationId, scope } = ctx;

  return {
    id: 'memory-formation',

    async processOutputResult(args: ProcessOutputResultArgs) {
      try {
        const lastCell = await findLastCell(db, conversationId);
        const dbMessages = await getMessagesSinceLastCell(
          db,
          conversationId,
          lastCell?.endMessageId,
        );

        logger.debug('[memory] Boundary check', {
          conversationId,
          messageCount: dbMessages.length,
          threshold: 4,
        });

        if (dbMessages.length < 4) {
          return args.messages;
        }

        // If this is the first cell for the conversation, create it eagerly
        // at 4+ messages without requiring a topic boundary.
        // Subsequent cells still require boundary detection or hard limits.
        const isFirstCell = !lastCell;

        if (!isFirstCell) {
          // Run boundary detection for subsequent cells
          logger.info('[memory] Running boundary detection', {
            conversationId,
            messageCount: dbMessages.length,
          });
          const boundary = await detectBoundary({ messages: dbMessages });

          logger.info('[memory] Boundary result', {
            conversationId,
            shouldSplit: boundary.shouldSplit,
            reason: boundary.reason,
          });

          if (!boundary.shouldSplit) {
            return args.messages;
          }
        } else {
          logger.info('[memory] First cell — creating eagerly', {
            conversationId,
            messageCount: dbMessages.length,
          });
        }

        const cellId = await createCellAndQueueFormation(db, scheduler, {
          threadId: conversationId,
          contactId: scope.contactId,
          messages: dbMessages,
        });

        logger.info('[memory] Cell created, queuing formation', {
          conversationId,
          cellId,
          messageCount: dbMessages.length,
        });
      } catch (err) {
        // Memory formation failures must never break chat
        logger.error('[memory] Formation check failed', {
          conversationId,
          error: err,
        });
      }

      return args.messages;
    },
  };
}

/** Find the most recent MemCell for a conversation. */
async function findLastCell(db: VobaseDb, threadId: string) {
  return (
    await db
      .select({
        id: aiMemCells.id,
        endMessageId: aiMemCells.endMessageId,
      })
      .from(aiMemCells)
      .where(eq(aiMemCells.threadId, threadId))
      .orderBy(desc(aiMemCells.createdAt))
      .limit(1)
  )[0];
}

/** Create a pending MemCell and queue the formation job. */
async function createCellAndQueueFormation(
  db: VobaseDb,
  scheduler: { add: (name: string, data: unknown) => Promise<unknown> },
  opts: {
    threadId: string;
    contactId: string;
    messages: MemoryMessage[];
  },
): Promise<string> {
  const first = opts.messages[0];
  const last = opts.messages[opts.messages.length - 1];

  const [cell] = await db
    .insert(aiMemCells)
    .values({
      threadId: opts.threadId,
      contactId: opts.contactId,
      startMessageId: first.id,
      endMessageId: last.id,
      messageCount: opts.messages.length,
      tokenCount: computeBufferTokens(opts.messages),
      status: 'pending',
    })
    .returning({ id: aiMemCells.id });

  await scheduler.add('ai:memory-formation', { cellId: cell.id });
  return cell.id;
}

/**
 * Flush unflushed messages into a MemCell on conversation completion.
 * Ensures every conversation produces memory regardless of boundary detection.
 */
export async function flushConversationMemory(opts: {
  db: VobaseDb;
  scheduler: { add: (name: string, data: unknown) => Promise<unknown> };
  conversationId: string;
  contactId: string;
}): Promise<void> {
  const { db, scheduler, conversationId, contactId } = opts;

  try {
    const lastCell = await findLastCell(db, conversationId);
    const messages = await getMessagesSinceLastCell(
      db,
      conversationId,
      lastCell?.endMessageId,
    );

    if (messages.length < 2) return;

    const cellId = await createCellAndQueueFormation(db, scheduler, {
      threadId: conversationId,
      contactId,
      messages,
    });

    logger.info('[memory] Flushed conversation memory on completion', {
      conversationId,
      cellId,
      messageCount: messages.length,
    });
  } catch (err) {
    logger.error('[memory] Flush on completion failed', {
      conversationId,
      error: err,
    });
  }
}

/**
 * Get messages in a conversation since the last MemCell's end message.
 * Reads directly from the messages table (conversations pgSchema).
 */
async function getMessagesSinceLastCell(
  _db: VobaseDb,
  conversationId: string,
  lastEndMessageId?: string,
): Promise<MemoryMessage[]> {
  const allMessages = await loadMessagesForConversation(_db, conversationId);

  if (!lastEndMessageId) return allMessages.slice(-100);

  // Find the boundary message and return everything after it
  const boundaryIdx = allMessages.findIndex((m) => m.id === lastEndMessageId);
  if (boundaryIdx === -1) return allMessages.slice(-100);

  return allMessages.slice(boundaryIdx + 1, boundaryIdx + 101);
}
