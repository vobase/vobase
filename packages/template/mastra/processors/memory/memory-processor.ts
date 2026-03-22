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
import { retrieveMemory } from './retriever';
import type { MemoryMessage, MemoryScope } from './types';

interface MemoryProcessorContext {
  db: VobaseDb;
  scheduler: Scheduler;
  threadId: string;
  scope: MemoryScope;
}

/**
 * Mastra InputProcessor: retrieves relevant memory and injects as system messages.
 */
export function createMemoryInputProcessor(
  ctx: Omit<MemoryProcessorContext, 'scheduler'>,
): InputProcessor {
  const { db, threadId, scope } = ctx;

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
        // Memory retrieval failure must never break chat
        console.error(`[memory] Retrieval failed for thread ${threadId}:`, err);
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
  const { db, scheduler, threadId, scope } = ctx;

  return {
    id: 'memory-formation',

    async processOutputResult(args: ProcessOutputResultArgs) {
      try {
        // Find messages since the last MemCell boundary in this thread
        const lastCell = (
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

        // Get thread messages from DB since the last boundary
        const dbMessages = await getMessagesSinceLastCell(
          db,
          threadId,
          lastCell?.endMessageId,
        );

        logger.debug('[memory] Boundary check', {
          threadId,
          messageCount: dbMessages.length,
          threshold: 4,
        });

        if (dbMessages.length < 4) {
          return args.messages;
        }

        // Run boundary detection
        logger.info('[memory] Running boundary detection', {
          threadId,
          messageCount: dbMessages.length,
        });
        const boundary = await detectBoundary({ messages: dbMessages });

        logger.info('[memory] Boundary result', {
          threadId,
          shouldSplit: boundary.shouldSplit,
          reason: boundary.reason,
        });

        if (!boundary.shouldSplit) {
          return args.messages;
        }

        // Create MemCell row
        const firstMsg = dbMessages[0];
        const lastMsg = dbMessages[dbMessages.length - 1];

        // Store contactId as primary scope key for channel conversations.
        // userId is only stored when there's no contactId (web chat).
        // This ensures retrieval uses a single, unambiguous scope column.
        const [cell] = await db
          .insert(aiMemCells)
          .values({
            threadId,
            contactId: scope.contactId ?? null,
            userId: scope.contactId ? null : scope.userId,
            startMessageId: firstMsg.id,
            endMessageId: lastMsg.id,
            messageCount: dbMessages.length,
            tokenCount: computeBufferTokens(dbMessages),
            status: 'pending',
          })
          .returning({ id: aiMemCells.id });

        logger.info('[memory] Cell created, queuing formation', {
          threadId,
          cellId: cell.id,
          messageCount: dbMessages.length,
        });

        // Queue formation job
        await scheduler.add('ai:memory-formation', {
          cellId: cell.id,
        });
      } catch (err) {
        // Memory formation failures must never break chat
        logger.error('[memory] Formation check failed', {
          threadId,
          error: err,
        });
      }

      return args.messages;
    },
  };
}

/**
 * Get messages in a thread since the last MemCell's end message.
 * Loads from Mastra Memory instead of the removed msgMessages table.
 */
async function getMessagesSinceLastCell(
  _db: VobaseDb,
  threadId: string,
  lastEndMessageId?: string,
): Promise<MemoryMessage[]> {
  const { loadMessagesForThread } = await import('./message-source');
  const allMessages = await loadMessagesForThread(_db, threadId);

  if (!lastEndMessageId) return allMessages.slice(-100);

  // Find the boundary message and return everything after it
  const boundaryIdx = allMessages.findIndex((m) => m.id === lastEndMessageId);
  if (boundaryIdx === -1) return allMessages.slice(-100);

  return allMessages.slice(boundaryIdx + 1, boundaryIdx + 101);
}
