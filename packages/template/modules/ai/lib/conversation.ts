import type { RealtimeService, Scheduler, VobaseDb } from '@vobase/core';
import { createNanoid, logger, notFound } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { channelRoutings, conversations } from '../schema';
import { getModuleDeps } from './deps';
import { createActivityMessage } from './messages';
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
  const { db } = deps;
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

  // Emit conversation.created activity event
  await createActivityMessage(db, deps.realtime, {
    conversationId: id,
    eventType: 'conversation.created',
    actor: input.agentId,
    actorType: 'agent',
    data: {
      contactId: input.contactId,
      channelRoutingId: input.channelRoutingId,
    },
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

  logger.info('[conversations] conversation_create', {
    conversationId: id,
    channelRoutingId: input.channelRoutingId,
    agentId: input.agentId,
    durationMs: Date.now() - start,
    outcome: 'created',
  });

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

  logger.info('[conversations] conversation_fail', {
    conversationId,
    reason,
    durationMs: Date.now() - start,
    outcome: 'failed',
  });
}
