import type { RealtimeService, VobaseDb } from '@vobase/core';
import { and, eq } from 'drizzle-orm';

import { conversations } from '../schema';
import { computeTab } from './activity-events';
import { agentAssignee, isAgentAssignee } from './assignee';
import { createActivityMessage } from './messages';

// ─── Public types ─────────────────────────────────────────────────────────────

type TransitionEvent =
  | { type: 'REASSIGN'; assignee: string; reason: string; userId?: string }
  | { type: 'HOLD'; reason: string; userId?: string }
  | { type: 'UNHOLD'; userId?: string }
  | {
      type: 'RESOLVE';
      outcome?: 'resolved' | 'escalated' | 'abandoned' | 'topic_change';
    }
  | { type: 'FAIL'; reason: string }
  | { type: 'INBOUND_MESSAGE'; contactId: string; content?: string }
  | { type: 'SET_RESOLVING' }
  | {
      type: 'GENERATION_DONE';
      outcome?: 'resolved' | 'escalated' | 'abandoned' | 'topic_change';
    }
  | { type: 'RESOLVING_TIMEOUT' }
  | { type: 'REOPEN'; idleWindowMs: number };

type ConversationRow = typeof conversations.$inferSelect;
type PreviousState = {
  status: string;
  assignee: string;
};

type TransitionResult =
  | { ok: true; conversation: ConversationRow; previousState: PreviousState }
  | {
      ok: false;
      error: string;
      code: 'INVALID_TRANSITION' | 'GUARD_FAILED' | 'CONCURRENCY_CONFLICT';
    };

// ─── Internal helpers ─────────────────────────────────────────────────────────

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

/**
 * Compute autonomy level based on assignee at resolution time.
 * If currently assigned to a user (not agent:*), it was human-assisted.
 */
function computeAutonomyLevel(
  current: ConversationRow,
): 'full_ai' | 'ai_with_escalation' | 'human_assisted' | 'human_only' {
  if (!isAgentAssignee(current.assignee)) return 'human_assisted';
  return 'full_ai';
}

/** Post-transition epilogue: notify realtime + return success */
async function commitTransition(
  _db: VobaseDb,
  realtime: RealtimeService,
  conversationId: string,
  updated: ConversationRow,
  current: ConversationRow,
  previousState: PreviousState,
  extraNotifications?: Array<{ table: string; action?: string }>,
): Promise<TransitionResult> {
  if (extraNotifications) {
    for (const n of extraNotifications) {
      await realtime.notify(n);
    }
  }

  await realtime.notify({
    table: 'conversations',
    id: conversationId,
    tab: computeTab(updated.status, updated.onHold),
    prevTab: computeTab(current.status, current.onHold),
  });

  return { ok: true, conversation: updated, previousState };
}

// ─── transition() ─────────────────────────────────────────────────────────────

/**
 * Central conversation state machine. All transitions that mutate status,
 * assignee, assignedAt, onHold, heldAt, holdReason flow through here.
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

  const state = current.status;
  const previousState = {
    status: current.status,
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

  // ── REASSIGN ─────────────────────────────────────────────────────────────

  if (event.type === 'REASSIGN') {
    const { assignee, reason, userId } = event;

    if (current.assignee === assignee) {
      return { ok: false, error: 'Already assigned to this assignee', code: 'GUARD_FAILED' } as const;
    }

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(conversations)
        .set({
          assignee,
          assignedAt: new Date(),
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'active'),
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
      conversationId: conversationId,
      data: {
        from: current.assignee,
        to: assignee,
        reason,
      },
    });
    return commitTransition(
      db,
      realtime,
      conversationId,
      result.updated,
      current,
      previousState,
    );
  }

  // ── HOLD ──────────────────────────────────────────────────────────────────

  if (event.type === 'HOLD') {
    const { reason, userId } = event;

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(conversations)
        .set({
          onHold: true,
          heldAt: new Date(),
          holdReason: reason,
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'active'),
            eq(conversations.onHold, false),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'conversation.held',
      actor: userId,
      actorType: 'user',
      conversationId: conversationId,
      data: { reason },
    });
    return commitTransition(
      db,
      realtime,
      conversationId,
      result.updated,
      current,
      previousState,
    );
  }

  // ── UNHOLD ────────────────────────────────────────────────────────────────

  if (event.type === 'UNHOLD') {
    const { userId } = event;

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(conversations)
        .set({
          onHold: false,
          heldAt: null,
          holdReason: null,
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'active'),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'conversation.unheld',
      actor: userId,
      actorType: 'user',
      conversationId: conversationId,
    });
    return commitTransition(
      db,
      realtime,
      conversationId,
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
        .update(conversations)
        .set({
          status: 'resolved',
          resolvedAt: now,
          outcome: outcome ?? 'resolved',
          autonomyLevel: computeAutonomyLevel(current),
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'active'),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'conversation.resolved',
      actorType: 'system',
      conversationId: conversationId,
      data: { outcome: outcome ?? 'resolved' },
    });
    return commitTransition(
      db,
      realtime,
      conversationId,
      result.updated,
      current,
      previousState,
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
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'active'),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'conversation.failed',
      actorType: 'system',
      conversationId: conversationId,
      data: { reason },
    });
    return commitTransition(
      db,
      realtime,
      conversationId,
      result.updated,
      current,
      previousState,
      [
        { table: 'conversations-dashboard', action: 'update' },
        { table: 'conversations-metrics', action: 'update' },
      ],
    );
  }

  // ── INBOUND_MESSAGE ───────────────────────────────────────────────────────

  if (event.type === 'INBOUND_MESSAGE') {
    const { contactId, content } = event;

    await createActivityMessage(db, realtime, {
      eventType: 'message.inbound',
      actorType: 'system',
      conversationId: conversationId,
      data: { contactId, content: content?.slice(0, 200) },
    });

    await realtime.notify({
      table: 'conversations',
      id: conversationId,
      tab: computeTab(current.status, current.onHold),
    });

    return { ok: true, conversation: current, previousState };
  }

  // ── SET_RESOLVING (active → resolving) ────────────────────────────────

  if (event.type === 'SET_RESOLVING') {
    if (current.status !== 'active') {
      return invalid(state, 'SET_RESOLVING');
    }

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(conversations)
        .set({ status: 'resolving' })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'active'),
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
        .update(conversations)
        .set({
          status: 'resolved',
          resolvedAt: now,
          outcome: outcome ?? 'resolved',
          autonomyLevel: computeAutonomyLevel(current),
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'resolving'),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'conversation.resolved',
      actorType: 'system',
      conversationId: conversationId,
      data: { outcome: outcome ?? 'resolved' },
    });
    return commitTransition(
      db,
      realtime,
      conversationId,
      result.updated,
      current,
      previousState,
      [
        { table: 'conversations-dashboard', action: 'update' },
        { table: 'conversations-metrics', action: 'update' },
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
        .update(conversations)
        .set({
          status: 'failed',
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'resolving'),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'conversation.failed',
      actorType: 'system',
      conversationId: conversationId,
      data: { reason: 'Resolving timeout — generation did not finish' },
    });
    return commitTransition(
      db,
      realtime,
      conversationId,
      result.updated,
      current,
      previousState,
      [
        { table: 'conversations-dashboard', action: 'update' },
        { table: 'conversations-metrics', action: 'update' },
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
        .update(conversations)
        .set({
          status: 'active',
          resolvedAt: null,
          outcome: null,
          autonomyLevel: null,
          assignee: agentAssignee(current.agentId),
          assignedAt: null,
          onHold: false,
          heldAt: null,
          holdReason: null,
          unreadCount: 0,
          reopenCount: current.reopenCount + 1,
        })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.status, 'resolved'),
          ),
        )
        .returning();

      if (!updated) return null;
      return { updated };
    });

    if (!result) return conflict();
    await createActivityMessage(db, realtime, {
      eventType: 'conversation.reopened',
      actorType: 'system',
      conversationId: conversationId,
      data: { reopenCount: current.reopenCount + 1 },
    });
    return commitTransition(
      db,
      realtime,
      conversationId,
      result.updated,
      current,
      previousState,
      [{ table: 'conversations-dashboard', action: 'update' }],
    );
  }

  // TypeScript exhaustiveness guard
  const _: never = event;
  return { ok: false, error: 'Unknown event type', code: 'INVALID_TRANSITION' };
}
