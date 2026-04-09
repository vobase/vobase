import type { RealtimeService, VobaseDb } from '@vobase/core';
import { and, eq, isNull } from 'drizzle-orm';

import { consultations, interactions } from '../schema';
import { computeTab } from './activity-events';
import { createActivityMessage } from './messages';

// ─── Public types ─────────────────────────────────────────────────────────────

type TransitionEvent =
  | {
      type: 'SET_MODE';
      mode: 'ai' | 'human' | 'supervised' | 'held';
      userId?: string;
    }
  | { type: 'ASSIGN'; assignee: string; userId: string }
  | { type: 'UNASSIGN'; userId: string }
  | { type: 'HANDBACK'; userId: string }
  | {
      type: 'RESOLVE';
      outcome?: 'resolved' | 'escalated' | 'abandoned' | 'topic_change';
    }
  | { type: 'FAIL'; reason: string }
  | { type: 'ESCALATE' }
  | { type: 'RESOLVE_ESCALATION' }
  | { type: 'INBOUND_MESSAGE'; contactId: string; content?: string }
  | { type: 'CLAIM'; userId: string }
  | {
      type: 'ESCALATE_MODE';
      mode: 'supervised' | 'human';
      priority?: 'low' | 'normal' | 'high' | 'urgent';
    }
  | { type: 'SET_RESOLVING' }
  | {
      type: 'GENERATION_DONE';
      outcome?: 'resolved' | 'escalated' | 'abandoned' | 'topic_change';
    }
  | { type: 'RESOLVING_TIMEOUT' }
  | { type: 'REOPEN'; idleWindowMs: number };

type InteractionRow = typeof interactions.$inferSelect;
type PreviousState = {
  status: string;
  mode: string | null;
  assignee: string | null;
};

type TransitionResult =
  | { ok: true; interaction: InteractionRow; previousState: PreviousState }
  | {
      ok: false;
      error: string;
      code: 'INVALID_TRANSITION' | 'GUARD_FAILED' | 'CONCURRENCY_CONFLICT';
    };

// ─── Internal helpers ─────────────────────────────────────────────────────────

const HUMAN_MODES = ['human', 'supervised', 'held'] as const;

/** Drizzle transaction → VobaseDb for helpers that accept VobaseDb */
function txDb(
  tx: Parameters<Parameters<VobaseDb['transaction']>[0]>[0],
): VobaseDb {
  return tx as unknown as VobaseDb;
}

function invalid(state: string, event: string): TransitionResult {
  return {
    ok: false,
    error: `Event '${event}' is not valid in state '${state}'`,
    code: 'INVALID_TRANSITION',
  };
}

function conflict(): TransitionResult {
  return {
    ok: false,
    error: 'Interaction state changed concurrently — retry the operation',
    code: 'CONCURRENCY_CONFLICT',
  };
}

async function hasPendingConsultations(
  db: VobaseDb,
  interactionId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: consultations.id })
    .from(consultations)
    .where(
      and(
        eq(consultations.interactionId, interactionId),
        eq(consultations.status, 'pending'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Compute autonomy level based on interaction history.
 * Checks mode transitions to determine how much human involvement occurred.
 */
function computeAutonomyLevel(
  current: InteractionRow,
): 'full_ai' | 'ai_with_escalation' | 'human_assisted' | 'human_only' {
  // If currently in human mode or was ever assigned, it was human-assisted at minimum
  if (current.mode === 'human') return 'human_only';
  if (current.assignee !== null || current.assignedAt !== null)
    return 'human_assisted';
  if (current.hasPendingEscalation) return 'ai_with_escalation';
  return 'full_ai';
}

/** Post-transition epilogue: notify realtime + return success */
async function commitTransition(
  _db: VobaseDb,
  realtime: RealtimeService,
  interactionId: string,
  updated: InteractionRow,
  current: InteractionRow,
  previousState: PreviousState,
  extraNotifications?: Array<{ table: string; action?: string }>,
): Promise<TransitionResult> {
  if (extraNotifications) {
    for (const n of extraNotifications) {
      await realtime.notify(n);
    }
  }

  await realtime.notify({
    table: 'interactions',
    id: interactionId,
    tab: computeTab(updated.mode, updated.status, updated.hasPendingEscalation),
    prevTab: computeTab(
      current.mode,
      current.status,
      current.hasPendingEscalation,
    ),
  });

  return { ok: true, interaction: updated, previousState };
}

// ─── transition() ─────────────────────────────────────────────────────────────

/**
 * Central interaction state machine. All transitions that mutate status, mode,
 * assignee, assignedAt, waitingSince, or hasPendingEscalation flow through here.
 *
 * Uses optimistic concurrency via WHERE clause (no SELECT FOR UPDATE — PGlite-compatible).
 * Each transition atomically: updates the interaction row + inserts an activity event.
 */
export async function transition(
  deps: { db: VobaseDb; realtime: RealtimeService },
  interactionId: string,
  event: TransitionEvent,
): Promise<TransitionResult> {
  const { db, realtime } = deps;

  const [current] = await db
    .select()
    .from(interactions)
    .where(eq(interactions.id, interactionId));

  if (!current) {
    return { ok: false, error: 'Interaction not found', code: 'GUARD_FAILED' };
  }

  const state = `${current.status}:${current.mode}`;
  const previousState = {
    status: current.status,
    mode: current.mode,
    assignee: current.assignee,
  };

  // Terminal state: only 'failed' is terminal (rejects all events)
  if (current.status === 'failed') {
    return invalid(state, event.type);
  }

  // Resolved accepts only REOPEN
  if (current.status === 'resolved') {
    if (event.type !== 'REOPEN') {
      return invalid(state, event.type);
    }
  }

  // Resolving only accepts GENERATION_DONE and RESOLVING_TIMEOUT
  if (current.status === 'resolving') {
    if (
      event.type !== 'GENERATION_DONE' &&
      event.type !== 'RESOLVING_TIMEOUT'
    ) {
      return invalid(state, event.type);
    }
  }

  // ── SET_MODE ──────────────────────────────────────────────────────────────

  if (event.type === 'SET_MODE') {
    const { mode, userId } = event;
    const currentMode = current.mode ?? 'ai';

    if (mode === currentMode) return invalid(state, 'SET_MODE');

    const isHumanMode = HUMAN_MODES.includes(
      mode as (typeof HUMAN_MODES)[number],
    );
    const wasHumanMode = HUMAN_MODES.includes(
      currentMode as (typeof HUMAN_MODES)[number],
    );
    const waitingSince: Date | null | undefined =
      isHumanMode && !wasHumanMode
        ? new Date()
        : !isHumanMode
          ? null
          : undefined;

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(interactions)
        .set({
          mode,
          ...(waitingSince !== undefined ? { waitingSince } : {}),
        })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.status, current.status),
            eq(interactions.mode, current.mode),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'handler.changed',
      actor: userId,
      actorType: 'user',
      interactionId: interactionId,
      data: { from: currentMode, to: mode, reason: 'Staff action' },
    });
    return commitTransition(
      db,
      realtime,
      interactionId,
      result.updated,
      current,
      previousState,
    );
  }

  // ── ASSIGN ────────────────────────────────────────────────────────────────

  if (event.type === 'ASSIGN') {
    const { assignee, userId } = event;
    if (current.mode !== 'ai') return invalid(state, 'ASSIGN');

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(interactions)
        .set({
          mode: 'human',
          assignee,
          assignedAt: new Date(),
          waitingSince: new Date(),
        })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.status, 'active'),
            eq(interactions.mode, 'ai'),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'handler.changed',
      actor: userId,
      actorType: 'user',
      interactionId: interactionId,
      data: { from: 'ai', to: 'human', reason: 'Assigned to staff' },
    });
    return commitTransition(
      db,
      realtime,
      interactionId,
      result.updated,
      current,
      previousState,
    );
  }

  // ── UNASSIGN ──────────────────────────────────────────────────────────────

  if (event.type === 'UNASSIGN') {
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(interactions)
        .set({ assignee: null, assignedAt: null })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.status, 'active'),
            eq(interactions.mode, current.mode),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'interaction.unassigned',
      actor: event.userId,
      actorType: 'user',
      interactionId: interactionId,
      data: { previousAssignee: current.assignee },
    });
    return commitTransition(
      db,
      realtime,
      interactionId,
      result.updated,
      current,
      previousState,
    );
  }

  // ── HANDBACK ─────────────────────────────────────────────────────────────

  if (event.type === 'HANDBACK') {
    const { userId } = event;
    if (!HUMAN_MODES.includes(current.mode as (typeof HUMAN_MODES)[number])) {
      return invalid(state, 'HANDBACK');
    }

    const result = await db.transaction(async (tx) => {
      const pendingExists = await hasPendingConsultations(
        txDb(tx),
        interactionId,
      );

      const [updated] = await tx
        .update(interactions)
        .set({
          mode: 'ai',
          assignee: null,
          assignedAt: null,
          waitingSince: null,
          unreadCount: 0,
          hasPendingEscalation: pendingExists,
        })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.status, 'active'),
            eq(interactions.mode, current.mode),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'handler.changed',
      actor: userId,
      actorType: 'user',
      interactionId: interactionId,
      data: { from: current.mode, to: 'ai', reason: 'Staff handback' },
    });
    return commitTransition(
      db,
      realtime,
      interactionId,
      result.updated,
      current,
      previousState,
    );
  }

  // ── RESOLVE (active → resolved) ─────────────────────────────────────────

  if (event.type === 'RESOLVE') {
    const { outcome } = event;
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(interactions)
        .set({
          status: 'resolved',
          resolvedAt: now,
          waitingSince: null,
          outcome: outcome ?? 'resolved',
          autonomyLevel: computeAutonomyLevel(current),
        })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.status, 'active'),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'interaction.resolved',
      actorType: 'system',
      interactionId: interactionId,
      data: { outcome: outcome ?? 'resolved' },
    });
    return commitTransition(
      db,
      realtime,
      interactionId,
      result.updated,
      current,
      previousState,
      [
        { table: 'interactions-dashboard', action: 'update' },
        { table: 'interactions-metrics', action: 'update' },
      ],
    );
  }

  // ── FAIL ─────────────────────────────────────────────────────────────────

  if (event.type === 'FAIL') {
    const { reason } = event;

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(interactions)
        .set({
          status: 'failed',
          waitingSince: null,
        })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.status, 'active'),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'interaction.failed',
      actorType: 'system',
      interactionId: interactionId,
      data: { reason },
    });
    return commitTransition(
      db,
      realtime,
      interactionId,
      result.updated,
      current,
      previousState,
      [
        { table: 'interactions-dashboard', action: 'update' },
        { table: 'interactions-metrics', action: 'update' },
      ],
    );
  }

  // ── ESCALATE ─────────────────────────────────────────────────────────────

  if (event.type === 'ESCALATE') {
    // Caller already inserted the consultation — hasPendingEscalation is always true
    const [updated] = await db
      .update(interactions)
      .set({ hasPendingEscalation: true })
      .where(
        and(
          eq(interactions.id, interactionId),
          eq(interactions.status, 'active'),
          eq(interactions.mode, current.mode),
        ),
      )
      .returning();

    if (!updated) return conflict();
    return commitTransition(
      db,
      realtime,
      interactionId,
      updated,
      current,
      previousState,
    );
  }

  // ── RESOLVE_ESCALATION ────────────────────────────────────────────────────

  if (event.type === 'RESOLVE_ESCALATION') {
    const result = await db.transaction(async (tx) => {
      // Re-derive — may still be true if other consultations are pending
      const pendingExists = await hasPendingConsultations(
        txDb(tx),
        interactionId,
      );

      const [updated] = await tx
        .update(interactions)
        .set({ hasPendingEscalation: pendingExists })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.status, 'active'),
            eq(interactions.mode, current.mode),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    return commitTransition(
      db,
      realtime,
      interactionId,
      result.updated,
      current,
      previousState,
    );
  }

  // ── INBOUND_MESSAGE ───────────────────────────────────────────────────────

  if (event.type === 'INBOUND_MESSAGE') {
    const { contactId, content } = event;
    const mode = current.mode ?? 'ai';

    await createActivityMessage(db, realtime, {
      eventType:
        mode === 'human' ? 'message.inbound_human_mode' : 'message.inbound',
      actorType: 'system',
      interactionId: interactionId,
      data: { contactId, content: content?.slice(0, 200) },
    });

    await realtime.notify({
      table: 'interactions',
      id: interactionId,
      tab: computeTab(mode, current.status, current.hasPendingEscalation),
    });

    return { ok: true, interaction: current, previousState };
  }

  // ── CLAIM ─────────────────────────────────────────────────────────────────

  if (event.type === 'CLAIM') {
    const { userId } = event;

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(interactions)
        .set({ assignee: userId, assignedAt: new Date() })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.status, 'active'),
            isNull(interactions.assignee),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'interaction.claimed',
      actor: userId,
      actorType: 'user',
      interactionId: interactionId,
    });
    return commitTransition(
      db,
      realtime,
      interactionId,
      result.updated,
      current,
      previousState,
    );
  }

  // ── ESCALATE_MODE ──────────────────────────────────────────────────────

  if (event.type === 'ESCALATE_MODE') {
    const { mode, priority } = event;
    const currentMode = current.mode ?? 'ai';

    if (currentMode === 'human') {
      return {
        ok: false,
        error: 'Cannot downgrade from human mode',
        code: 'GUARD_FAILED',
      };
    }
    if (currentMode === mode) {
      return {
        ok: false,
        error: `Already in ${mode} mode`,
        code: 'GUARD_FAILED',
      };
    }

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(interactions)
        .set({
          mode,
          ...(priority ? { priority } : {}),
        })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.status, 'active'),
            eq(interactions.mode, current.mode),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'handler.changed',
      actorType: 'system',
      interactionId: interactionId,
      data: { from: currentMode, to: mode, reason: 'Agent escalation' },
    });
    return commitTransition(
      db,
      realtime,
      interactionId,
      result.updated,
      current,
      previousState,
    );
  }

  // ── SET_RESOLVING (active → resolving) ────────────────────────────────

  if (event.type === 'SET_RESOLVING') {
    if (current.status !== 'active') {
      return invalid(state, 'SET_RESOLVING');
    }

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(interactions)
        .set({ status: 'resolving' })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.status, 'active'),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    return commitTransition(
      db,
      realtime,
      interactionId,
      result.updated,
      current,
      previousState,
    );
  }

  // ── GENERATION_DONE (resolving → resolved) ───────────────────────────

  if (event.type === 'GENERATION_DONE') {
    if (current.status !== 'resolving') {
      return invalid(state, 'GENERATION_DONE');
    }
    const { outcome } = event;
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(interactions)
        .set({
          status: 'resolved',
          resolvedAt: now,
          waitingSince: null,
          outcome: outcome ?? 'resolved',
          autonomyLevel: computeAutonomyLevel(current),
        })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.status, 'resolving'),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'interaction.resolved',
      actorType: 'system',
      interactionId: interactionId,
      data: { outcome: outcome ?? 'resolved' },
    });
    return commitTransition(
      db,
      realtime,
      interactionId,
      result.updated,
      current,
      previousState,
      [
        { table: 'interactions-dashboard', action: 'update' },
        { table: 'interactions-metrics', action: 'update' },
      ],
    );
  }

  // ── RESOLVING_TIMEOUT (resolving → failed) ────────────────────────────

  if (event.type === 'RESOLVING_TIMEOUT') {
    if (current.status !== 'resolving') {
      return invalid(state, 'RESOLVING_TIMEOUT');
    }

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(interactions)
        .set({
          status: 'failed',
        })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.status, 'resolving'),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'interaction.failed',
      actorType: 'system',
      interactionId: interactionId,
      data: { reason: 'Resolving timeout — generation did not finish' },
    });
    return commitTransition(
      db,
      realtime,
      interactionId,
      result.updated,
      current,
      previousState,
      [
        { table: 'interactions-dashboard', action: 'update' },
        { table: 'interactions-metrics', action: 'update' },
      ],
    );
  }

  // ── REOPEN (resolved → active) ────────────────────────────────────────

  if (event.type === 'REOPEN') {
    if (current.status !== 'resolved') {
      return invalid(state, 'REOPEN');
    }

    // Guard: check idle window
    const { idleWindowMs } = event;
    if (current.resolvedAt) {
      const elapsed = Date.now() - current.resolvedAt.getTime();
      if (elapsed > idleWindowMs) {
        return {
          ok: false,
          error: `Idle window expired (${elapsed}ms > ${idleWindowMs}ms)`,
          code: 'GUARD_FAILED',
        };
      }
    }

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(interactions)
        .set({
          status: 'active',
          resolvedAt: null,
          outcome: null,
          autonomyLevel: null,
          mode: 'ai',
          assignee: null,
          assignedAt: null,
          waitingSince: null,
          unreadCount: 0,
          topicChangePending: false,
          reopenCount: current.reopenCount + 1,
        })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.status, 'resolved'),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'interaction.reopened',
      actorType: 'system',
      interactionId: interactionId,
      data: { reopenCount: current.reopenCount + 1 },
    });
    return commitTransition(
      db,
      realtime,
      interactionId,
      result.updated,
      current,
      previousState,
      [{ table: 'interactions-dashboard', action: 'update' }],
    );
  }

  // TypeScript exhaustiveness guard
  const _: never = event;
  return { ok: false, error: 'Unknown event type', code: 'INVALID_TRANSITION' };
}
