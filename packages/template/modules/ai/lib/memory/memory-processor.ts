import type {
  InputProcessor,
  OutputProcessor,
  ProcessInputArgs,
  ProcessInputResult,
  ProcessOutputResultArgs,
} from '@mastra/core/processors';
import type { Scheduler, VobaseDb } from '@vobase/core';
import { and, desc, eq, gt } from 'drizzle-orm';

import { msgMessages } from '../../../messaging/schema';
import { aiMemCells } from '../../schema';
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

        if (dbMessages.length < 4) {
          // Not enough messages to consider a boundary
          return args.messages;
        }

        // Run boundary detection
        const boundary = await detectBoundary({ messages: dbMessages });

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

        // Queue formation job
        await scheduler.add('ai:memory-formation', {
          cellId: cell.id,
        });
      } catch (err) {
        // Memory formation failures must never break chat
        console.error(
          `[memory] Formation check failed for thread ${threadId}:`,
          err,
        );
      }

      return args.messages;
    },
  };
}

/**
 * Get messages in a thread since the last MemCell's end message.
 * Uses SQL filtering to avoid loading entire thread history.
 */
async function getMessagesSinceLastCell(
  db: VobaseDb,
  threadId: string,
  lastEndMessageId?: string,
): Promise<MemoryMessage[]> {
  // If we have a boundary, resolve its timestamp for SQL filtering
  if (lastEndMessageId) {
    const boundary = (
      await db
        .select({ createdAt: msgMessages.createdAt })
        .from(msgMessages)
        .where(eq(msgMessages.id, lastEndMessageId))
        .limit(1)
    )[0];

    if (boundary) {
      const messages = await db
        .select({
          id: msgMessages.id,
          content: msgMessages.content,
          aiRole: msgMessages.aiRole,
          createdAt: msgMessages.createdAt,
        })
        .from(msgMessages)
        .where(
          and(
            eq(msgMessages.threadId, threadId),
            gt(msgMessages.createdAt, boundary.createdAt),
          ),
        )
        .orderBy(msgMessages.createdAt)
        .limit(100);

      return messages;
    }
  }

  // No prior cell — get recent messages (capped)
  const messages = await db
    .select({
      id: msgMessages.id,
      content: msgMessages.content,
      aiRole: msgMessages.aiRole,
      createdAt: msgMessages.createdAt,
    })
    .from(msgMessages)
    .where(eq(msgMessages.threadId, threadId))
    .orderBy(msgMessages.createdAt)
    .limit(100);

  return messages;
}
