import type { RealtimeService, Scheduler, VobaseDb } from '@vobase/core';
import { createNanoid, logger, notFound } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { getMemory } from '../../../mastra';
import { flushConversationMemory } from '../../../mastra/processors/memory/memory-processor';
import { channelRoutings, conversations } from '../schema';
import { emitActivityEvent } from './activity-events';
import { getChatState } from './chat-init';
import { getModuleDeps, getModuleScheduler } from './deps';
import { transition } from './state-machine';

const generateId = createNanoid();

interface CreateConversationInput {
  channelRoutingId: string;
  contactId: string;
  agentId: string;
  channelInstanceId: string;
}

interface CreateConversationDeps {
  db: VobaseDb;
  scheduler: Scheduler;
  realtime: RealtimeService;
}

export async function createConversation(
  deps: CreateConversationDeps,
  input: CreateConversationInput,
): Promise<typeof conversations.$inferSelect> {
  const { db, scheduler } = deps;
  const id = generateId();
  const start = Date.now();

  // M9: Verify the channelRouting exists before creating the conversation
  const [channelRouting] = await db
    .select()
    .from(channelRoutings)
    .where(eq(channelRoutings.id, input.channelRoutingId));

  if (!channelRouting) throw notFound('ChannelRouting not found');

  const [conversation] = await db
    .insert(conversations)
    .values({
      id,
      channelRoutingId: input.channelRoutingId,
      contactId: input.contactId,
      agentId: input.agentId,
      channelInstanceId: input.channelInstanceId,
      status: 'active',
    })
    .returning();

  // Emit conversation.created activity event (fire-and-forget)
  await emitActivityEvent(db, deps.realtime, {
    type: 'conversation.created',
    agentId: input.agentId,
    source: 'system',
    contactId: input.contactId,
    conversationId: id,
    channelRoutingId: input.channelRoutingId,
  });
  // Notify dashboard + metrics
  await deps.realtime.notify({
    table: 'conversations-dashboard',
    action: 'update',
  });
  await deps.realtime.notify({
    table: 'conversations-metrics',
    action: 'update',
  });

  // Subscribe in chat state for distributed tracking
  const state = getChatState();
  await state.subscribe(id);

  // Create Mastra Memory thread with the same ID (AD-2)
  try {
    const memory = getMemory();
    const now = new Date();
    await memory.saveThread({
      thread: {
        id,
        title: 'New conversation',
        resourceId: `contact:${input.contactId}`,
        createdAt: now,
        updatedAt: now,
        metadata: {
          agentId: input.agentId,
          channelInstanceId: input.channelInstanceId,
          channelRoutingId: input.channelRoutingId,
        },
      },
    });

    logger.info('[conversations] conversation_create', {
      conversationId: id,
      channelRoutingId: input.channelRoutingId,
      agentId: input.agentId,
      durationMs: Date.now() - start,
      outcome: 'created',
    });
  } catch (err) {
    logger.error(
      '[conversations] Failed to create memory thread — conversation degraded',
      {
        conversationId: id,
        error: err,
      },
    );

    // Mark conversation as memory-degraded so agent knows context is limited
    await db
      .update(conversations)
      .set({
        metadata: { memoryDegraded: true },
      })
      .where(eq(conversations.id, id));

    logger.info('[conversations] conversation_create', {
      conversationId: id,
      channelRoutingId: input.channelRoutingId,
      agentId: input.agentId,
      durationMs: Date.now() - start,
      outcome: 'degraded',
    });

    // Schedule retry job to attempt memory thread creation later
    await scheduler
      .add('ai:retry-memory-thread', {
        conversationId: id,
        contactId: input.contactId,
        agentId: input.agentId,
        channelInstanceId: input.channelInstanceId,
        channelRoutingId: input.channelRoutingId,
        attempt: 1,
      })
      .catch(() => {
        // Best-effort retry scheduling
      });
  }

  return conversation;
}

export async function completeConversation(
  db: VobaseDb,
  conversationId: string,
  realtime?: RealtimeService,
  resolutionOutcome?:
    | 'resolved'
    | 'escalated_resolved'
    | 'abandoned'
    | 'failed',
): Promise<void> {
  const start = Date.now();
  const rt = realtime ?? getModuleDeps().realtime;

  const result = await transition({ db, realtime: rt }, conversationId, {
    type: 'COMPLETE',
    resolutionOutcome,
  });

  if (!result.ok) {
    logger.info('[conversations] conversation_complete', {
      conversationId,
      durationMs: Date.now() - start,
      outcome: 'skipped',
    });
    return;
  }

  const state = getChatState();
  await state.unsubscribe(conversationId);

  // Flush unflushed messages into memory on conversation completion
  const contactId = result.conversation.contactId;
  if (contactId) {
    try {
      const scheduler = getModuleScheduler();
      await flushConversationMemory({
        db,
        scheduler,
        conversationId,
        contactId,
      });
    } catch (err) {
      logger.warn('[conversations] Memory flush failed', {
        conversationId,
        error: err,
      });
    }
  }

  logger.info('[conversations] conversation_complete', {
    conversationId,
    durationMs: Date.now() - start,
    outcome: 'completed',
  });
}

export async function failConversation(
  db: VobaseDb,
  conversationId: string,
  reason: string,
  realtime?: RealtimeService,
): Promise<void> {
  const start = Date.now();
  const rt = realtime ?? getModuleDeps().realtime;

  const result = await transition({ db, realtime: rt }, conversationId, {
    type: 'FAIL',
    reason,
  });

  if (!result.ok) {
    logger.info('[conversations] conversation_fail', {
      conversationId,
      reason,
      durationMs: Date.now() - start,
      outcome: 'skipped',
    });
    return;
  }

  // Merge failReason into metadata — uses result.conversation to avoid an extra read
  const existingMeta =
    result.conversation.metadata &&
    typeof result.conversation.metadata === 'object'
      ? (result.conversation.metadata as Record<string, unknown>)
      : {};
  await db
    .update(conversations)
    .set({ metadata: { ...existingMeta, failReason: reason } })
    .where(eq(conversations.id, conversationId));

  const state = getChatState();
  await state.unsubscribe(conversationId);

  logger.info('[conversations] conversation_fail', {
    conversationId,
    reason,
    durationMs: Date.now() - start,
    outcome: 'failed',
  });
}
