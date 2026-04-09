import type { RealtimeService, Scheduler, VobaseDb } from '@vobase/core';
import { createNanoid, logger, notFound } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { channelRoutings, interactions } from '../schema';
import { getModuleDeps } from './deps';
import { createActivityMessage } from './messages';
import { transition } from './state-machine';

const generateId = createNanoid();

interface CreateInteractionInput {
  channelRoutingId: string;
  contactId: string;
  agentId: string;
  channelInstanceId: string;
}

interface CreateInteractionDeps {
  db: VobaseDb;
  scheduler: Scheduler;
  realtime: RealtimeService;
}

export async function createInteraction(
  deps: CreateInteractionDeps,
  input: CreateInteractionInput,
): Promise<typeof interactions.$inferSelect> {
  const { db } = deps;
  const id = generateId();
  const start = Date.now();

  // Verify the channelRouting exists before creating the interaction
  const [channelRouting] = await db
    .select()
    .from(channelRoutings)
    .where(eq(channelRoutings.id, input.channelRoutingId));

  if (!channelRouting) throw notFound('ChannelRouting not found');

  const [interaction] = await db
    .insert(interactions)
    .values({
      id,
      channelRoutingId: input.channelRoutingId,
      contactId: input.contactId,
      agentId: input.agentId,
      channelInstanceId: input.channelInstanceId,
      status: 'active',
    })
    .returning();

  // Emit interaction.created activity event
  await createActivityMessage(db, deps.realtime, {
    interactionId: id,
    eventType: 'interaction.created',
    actor: input.agentId,
    actorType: 'agent',
    data: {
      contactId: input.contactId,
      channelRoutingId: input.channelRoutingId,
    },
  });
  // Notify dashboard + metrics
  await deps.realtime.notify({
    table: 'interactions-dashboard',
    action: 'update',
  });
  await deps.realtime.notify({
    table: 'interactions-metrics',
    action: 'update',
  });

  logger.info('[interactions] interaction_create', {
    interactionId: id,
    channelRoutingId: input.channelRoutingId,
    agentId: input.agentId,
    durationMs: Date.now() - start,
    outcome: 'created',
  });

  return interaction;
}

export async function resolveInteraction(
  db: VobaseDb,
  interactionId: string,
  realtime?: RealtimeService,
  outcome?: 'resolved' | 'escalated' | 'abandoned' | 'topic_change',
): Promise<void> {
  const start = Date.now();
  const rt = realtime ?? getModuleDeps().realtime;

  const result = await transition({ db, realtime: rt }, interactionId, {
    type: 'RESOLVE',
    outcome,
  });

  if (!result.ok) {
    logger.info('[interactions] interaction_resolve', {
      interactionId,
      durationMs: Date.now() - start,
      outcome: 'skipped',
    });
    return;
  }

  logger.info('[interactions] interaction_resolve', {
    interactionId,
    durationMs: Date.now() - start,
    outcome: 'resolved',
  });
}

export async function failInteraction(
  db: VobaseDb,
  interactionId: string,
  reason: string,
  realtime?: RealtimeService,
): Promise<void> {
  const start = Date.now();
  const rt = realtime ?? getModuleDeps().realtime;

  const result = await transition({ db, realtime: rt }, interactionId, {
    type: 'FAIL',
    reason,
  });

  if (!result.ok) {
    logger.info('[interactions] interaction_fail', {
      interactionId,
      reason,
      durationMs: Date.now() - start,
      outcome: 'skipped',
    });
    return;
  }

  // Merge failReason into metadata — uses result.interaction to avoid an extra read
  const existingMeta =
    result.interaction.metadata &&
    typeof result.interaction.metadata === 'object'
      ? (result.interaction.metadata as Record<string, unknown>)
      : {};
  await db
    .update(interactions)
    .set({ metadata: { ...existingMeta, failReason: reason } })
    .where(eq(interactions.id, interactionId));

  logger.info('[interactions] interaction_fail', {
    interactionId,
    reason,
    durationMs: Date.now() - start,
    outcome: 'failed',
  });
}

export async function reopenInteraction(
  deps: { db: VobaseDb; realtime: RealtimeService },
  interactionId: string,
  idleWindowMs: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await transition(deps, interactionId, {
    type: 'REOPEN',
    idleWindowMs,
  });

  if (!result.ok) {
    logger.info('[interactions] interaction_reopen', {
      interactionId,
      outcome: 'rejected',
      error: result.error,
    });
    return { ok: false, error: result.error };
  }

  logger.info('[interactions] interaction_reopen', {
    interactionId,
    outcome: 'reopened',
    reopenCount: result.interaction.reopenCount,
  });

  return { ok: true };
}
