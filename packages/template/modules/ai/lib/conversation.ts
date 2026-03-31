import type { RealtimeService, Scheduler, VobaseDb } from '@vobase/core';
import { createNanoid, logger, notFound } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { getMemory } from '../../../mastra';
import { flushConversationMemory } from '../../../mastra/processors/memory/memory-processor';
import { channelRoutings, conversations } from '../schema';
import { computeTab, emitActivityEvent } from './activity-events';
import { getChatState } from './chat-init';
import { getModuleScheduler } from './deps';

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

  const [prev] = await db
    .select({
      mode: conversations.mode,
      contactId: conversations.contactId,
      hasPendingEscalation: conversations.hasPendingEscalation,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId));

  await db
    .update(conversations)
    .set({
      status: 'completed',
      endedAt: new Date(),
      waitingSince: null,
      ...(resolutionOutcome ? { resolutionOutcome } : {}),
    })
    .where(eq(conversations.id, conversationId));

  const state = getChatState();
  await state.unsubscribe(conversationId);

  // Emit conversation.completed activity event (fire-and-forget)
  if (realtime) {
    await emitActivityEvent(db, realtime, {
      type: 'conversation.completed',
      source: 'system',
      conversationId,
      data: { resolutionOutcome: resolutionOutcome ?? 'resolved' },
    });
    // Notify dashboard + metrics for real-time invalidation
    await realtime.notify({
      table: 'conversations-dashboard',
      action: 'update',
    });
    await realtime.notify({ table: 'conversations-metrics', action: 'update' });
    await realtime.notify({
      table: 'conversations',
      id: conversationId,
      tab: 'done',
      prevTab: computeTab(
        prev?.mode ?? null,
        'active',
        prev?.hasPendingEscalation ?? false,
      ),
    });
  }

  // Flush unflushed messages into memory on conversation completion
  if (prev?.contactId) {
    try {
      const scheduler = getModuleScheduler();
      await flushConversationMemory({
        db,
        scheduler,
        conversationId,
        contactId: prev.contactId,
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

  const [existing] = await db
    .select({
      metadata: conversations.metadata,
      mode: conversations.mode,
      hasPendingEscalation: conversations.hasPendingEscalation,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId));

  const metadata =
    existing?.metadata && typeof existing.metadata === 'object'
      ? {
          ...(existing.metadata as Record<string, unknown>),
          failReason: reason,
        }
      : { failReason: reason };

  await db
    .update(conversations)
    .set({
      status: 'failed',
      endedAt: new Date(),
      waitingSince: null,
      resolutionOutcome: 'failed',
      metadata,
    })
    .where(eq(conversations.id, conversationId));

  const state = getChatState();
  await state.unsubscribe(conversationId);

  // Emit conversation.failed activity event (fire-and-forget)
  if (realtime) {
    await emitActivityEvent(db, realtime, {
      type: 'conversation.failed',
      source: 'system',
      conversationId,
      data: { reason },
    });
    // Notify dashboard + metrics for real-time invalidation
    await realtime.notify({
      table: 'conversations-dashboard',
      action: 'update',
    });
    await realtime.notify({ table: 'conversations-metrics', action: 'update' });
    await realtime.notify({
      table: 'conversations',
      id: conversationId,
      tab: 'done',
      prevTab: computeTab(
        existing?.mode ?? null,
        'active',
        existing?.hasPendingEscalation ?? false,
      ),
    });
  }

  logger.info('[conversations] conversation_fail', {
    conversationId,
    reason,
    durationMs: Date.now() - start,
    outcome: 'failed',
  });
}
