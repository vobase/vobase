import type { RealtimeService, VobaseDb } from '@vobase/core';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { consultations, conversations } from '../schema';
import { computeTab, emitActivityEvent } from './activity-events';
import { updateLastSignal } from './last-signal';

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
      type: 'COMPLETE';
      resolutionOutcome?:
        | 'resolved'
        | 'escalated_resolved'
        | 'abandoned'
        | 'failed';
    }
  | { type: 'FAIL'; reason: string }
  | { type: 'ESCALATE' }
  | { type: 'RESOLVE_ESCALATION' }
  | { type: 'INBOUND_MESSAGE'; contactId: string; content?: string }
  | { type: 'CLAIM'; userId: string };

type ConversationRow = typeof conversations.$inferSelect;
type PreviousState = {
  status: string;
  mode: string | null;
  assignee: string | null;
};

type TransitionResult =
  | { ok: true; conversation: ConversationRow; previousState: PreviousState }
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
    error: 'Conversation state changed concurrently — retry the operation',
    code: 'CONCURRENCY_CONFLICT',
  };
}

async function hasPendingConsultations(
  db: VobaseDb,
  conversationId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: consultations.id })
    .from(consultations)
    .where(
      and(
        eq(consultations.conversationId, conversationId),
        eq(consultations.status, 'pending'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Post-transition epilogue: update lastSignal + notify realtime + return success */
async function commitTransition(
  db: VobaseDb,
  realtime: RealtimeService,
  conversationId: string,
  updated: ConversationRow,
  current: ConversationRow,
  previousState: PreviousState,
  eventId: string | null,
  extraNotifications?: Array<{ table: string; action?: string }>,
): Promise<TransitionResult> {
  if (eventId) {
    await updateLastSignal(db, conversationId, 'activity', eventId);
  }

  if (extraNotifications) {
    for (const n of extraNotifications) {
      await realtime.notify(n);
    }
  }

  await realtime.notify({
    table: 'conversations',
    id: conversationId,
    tab: computeTab(updated.mode, updated.status, updated.hasPendingEscalation),
    prevTab: computeTab(
      current.mode,
      current.status,
      current.hasPendingEscalation,
    ),
  });

  return { ok: true, conversation: updated, previousState };
}

// ─── transition() ─────────────────────────────────────────────────────────────

/**
 * Central conversation state machine. All transitions that mutate status, mode,
 * assignee, assignedAt, waitingSince, or hasPendingEscalation flow through here.
 *
 * Uses optimistic concurrency via WHERE clause (no SELECT FOR UPDATE — PGlite-compatible).
 * Each transition atomically: updates the conversation row + inserts an activity event.
 */
export async function transition(
  deps: { db: VobaseDb; realtime: RealtimeService },
  conversationId: string,
  event: TransitionEvent,
): Promise<TransitionResult> {
  const { db, realtime } = deps;

  const [current] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));

  if (!current) {
    return { ok: false, error: 'Conversation not found', code: 'GUARD_FAILED' };
  }

  const state = `${current.status}:${current.mode}`;
  const previousState = {
    status: current.status,
    mode: current.mode,
    assignee: current.assignee,
  };

  // Terminal states reject all events
  if (current.status === 'completed' || current.status === 'failed') {
    return invalid(state, event.type);
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
        .update(conversations)
        .set({
          mode,
          ...(waitingSince !== undefined ? { waitingSince } : {}),
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, current.status),
            eq(conversations.mode, current.mode),
          ),
        )
        .returning();

      if (!updated) return null;

      const eventId = await emitActivityEvent(
        db,
        realtime,
        {
          type: 'handler.changed',
          userId,
          source: 'staff',
          conversationId,
          data: { from: currentMode, to: mode, reason: 'Staff action' },
        },
        txDb(tx),
      );

      return { updated, eventId };
    });

    if (!result) return conflict();
    return commitTransition(
      db,
      realtime,
      conversationId,
      result.updated,
      current,
      previousState,
      result.eventId,
    );
  }

  // ── ASSIGN ────────────────────────────────────────────────────────────────

  if (event.type === 'ASSIGN') {
    const { assignee, userId } = event;
    if (current.mode !== 'ai') return invalid(state, 'ASSIGN');

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(conversations)
        .set({
          mode: 'human',
          assignee,
          assignedAt: new Date(),
          waitingSince: new Date(),
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'active'),
            eq(conversations.mode, 'ai'),
          ),
        )
        .returning();

      if (!updated) return null;

      const eventId = await emitActivityEvent(
        db,
        realtime,
        {
          type: 'handler.changed',
          userId,
          source: 'staff',
          conversationId,
          data: { from: 'ai', to: 'human', reason: 'Assigned to staff' },
        },
        txDb(tx),
      );

      return { updated, eventId };
    });

    if (!result) return conflict();
    return commitTransition(
      db,
      realtime,
      conversationId,
      result.updated,
      current,
      previousState,
      result.eventId,
    );
  }

  // ── UNASSIGN ──────────────────────────────────────────────────────────────

  if (event.type === 'UNASSIGN') {
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(conversations)
        .set({ assignee: null, assignedAt: null })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'active'),
            eq(conversations.mode, current.mode),
          ),
        )
        .returning();

      if (!updated) return null;

      const eventId = await emitActivityEvent(
        db,
        realtime,
        {
          type: 'conversation.unassigned',
          userId: event.userId,
          source: 'staff',
          conversationId,
          data: { previousAssignee: current.assignee },
        },
        txDb(tx),
      );

      return { updated, eventId };
    });

    if (!result) return conflict();
    return commitTransition(
      db,
      realtime,
      conversationId,
      result.updated,
      current,
      previousState,
      result.eventId,
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
        conversationId,
      );

      const [updated] = await tx
        .update(conversations)
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
            eq(conversations.id, conversationId),
            eq(conversations.status, 'active'),
            eq(conversations.mode, current.mode),
          ),
        )
        .returning();

      if (!updated) return null;

      const eventId = await emitActivityEvent(
        db,
        realtime,
        {
          type: 'handler.changed',
          userId,
          source: 'staff',
          conversationId,
          data: { from: current.mode, to: 'ai', reason: 'Staff handback' },
        },
        txDb(tx),
      );

      return { updated, eventId };
    });

    if (!result) return conflict();
    return commitTransition(
      db,
      realtime,
      conversationId,
      result.updated,
      current,
      previousState,
      result.eventId,
    );
  }

  // ── COMPLETE ─────────────────────────────────────────────────────────────

  if (event.type === 'COMPLETE') {
    const { resolutionOutcome } = event;

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(conversations)
        .set({
          status: 'completed',
          endedAt: new Date(),
          waitingSince: null,
          ...(resolutionOutcome ? { resolutionOutcome } : {}),
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'active'),
          ),
        )
        .returning();

      if (!updated) return null;

      await emitActivityEvent(
        db,
        realtime,
        {
          type: 'conversation.completed',
          source: 'system',
          conversationId,
          data: { resolutionOutcome: resolutionOutcome ?? 'resolved' },
        },
        txDb(tx),
      );

      return { updated };
    });

    if (!result) return conflict();
    return commitTransition(
      db,
      realtime,
      conversationId,
      result.updated,
      current,
      previousState,
      null,
      [
        { table: 'conversations-dashboard', action: 'update' },
        { table: 'conversations-metrics', action: 'update' },
      ],
    );
  }

  // ── FAIL ─────────────────────────────────────────────────────────────────

  if (event.type === 'FAIL') {
    const { reason } = event;

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(conversations)
        .set({
          status: 'failed',
          endedAt: new Date(),
          waitingSince: null,
          resolutionOutcome: 'failed',
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'active'),
          ),
        )
        .returning();

      if (!updated) return null;

      await emitActivityEvent(
        db,
        realtime,
        {
          type: 'conversation.failed',
          source: 'system',
          conversationId,
          data: { reason },
        },
        txDb(tx),
      );

      return { updated };
    });

    if (!result) return conflict();
    return commitTransition(
      db,
      realtime,
      conversationId,
      result.updated,
      current,
      previousState,
      null,
      [
        { table: 'conversations-dashboard', action: 'update' },
        { table: 'conversations-metrics', action: 'update' },
      ],
    );
  }

  // ── ESCALATE ─────────────────────────────────────────────────────────────

  if (event.type === 'ESCALATE') {
    // Caller already inserted the consultation — hasPendingEscalation is always true
    const [updated] = await db
      .update(conversations)
      .set({ hasPendingEscalation: true })
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.status, 'active'),
          eq(conversations.mode, current.mode),
        ),
      )
      .returning();

    if (!updated) return conflict();
    return commitTransition(
      db,
      realtime,
      conversationId,
      updated,
      current,
      previousState,
      null,
    );
  }

  // ── RESOLVE_ESCALATION ────────────────────────────────────────────────────

  if (event.type === 'RESOLVE_ESCALATION') {
    const result = await db.transaction(async (tx) => {
      // Re-derive — may still be true if other consultations are pending
      const pendingExists = await hasPendingConsultations(
        txDb(tx),
        conversationId,
      );

      const [updated] = await tx
        .update(conversations)
        .set({ hasPendingEscalation: pendingExists })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'active'),
            eq(conversations.mode, current.mode),
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
      conversationId,
      result.updated,
      current,
      previousState,
      null,
    );
  }

  // ── INBOUND_MESSAGE ───────────────────────────────────────────────────────

  if (event.type === 'INBOUND_MESSAGE') {
    const { contactId, content } = event;
    const mode = current.mode ?? 'ai';
    const isHumanHandled = HUMAN_MODES.includes(
      mode as (typeof HUMAN_MODES)[number],
    );

    // Optimistic concurrency: only increment if mode hasn't changed since read
    let updated = current;
    if (isHumanHandled) {
      const [row] = await db
        .update(conversations)
        .set({ unreadCount: sql`unread_count + 1` })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'active'),
            eq(conversations.mode, current.mode),
          ),
        )
        .returning();
      if (row) updated = row;
    }

    const eventId = await emitActivityEvent(db, realtime, {
      type: mode === 'human' ? 'message.inbound_human_mode' : 'message.inbound',
      source: 'system',
      contactId,
      conversationId,
      data: { content: content?.slice(0, 200) },
    });

    if (eventId) {
      await updateLastSignal(db, conversationId, 'activity', eventId);
    }

    await realtime.notify({
      table: 'conversations',
      id: conversationId,
      tab: computeTab(mode, current.status, current.hasPendingEscalation),
    });

    return { ok: true, conversation: updated, previousState };
  }

  // ── CLAIM ─────────────────────────────────────────────────────────────────

  if (event.type === 'CLAIM') {
    const { userId } = event;

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(conversations)
        .set({ assignee: userId, assignedAt: new Date() })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'active'),
            isNull(conversations.assignee),
          ),
        )
        .returning();

      if (!updated) return null;

      const eventId = await emitActivityEvent(
        db,
        realtime,
        {
          type: 'conversation.claimed',
          userId,
          source: 'staff',
          conversationId,
        },
        txDb(tx),
      );

      return { updated, eventId };
    });

    if (!result) return conflict();
    return commitTransition(
      db,
      realtime,
      conversationId,
      result.updated,
      current,
      previousState,
      result.eventId,
    );
  }

  // TypeScript exhaustiveness guard
  const _: never = event;
  return { ok: false, error: 'Unknown event type', code: 'INVALID_TRANSITION' };
}
