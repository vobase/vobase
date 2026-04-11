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

type TransitionResult =
  | {
      ok: true;
      conversation: ConversationRow;
      previousState: { status: string; assignee: string };
    }
  | {
      ok: false;
      error: string;
      code: 'INVALID_TRANSITION' | 'GUARD_FAILED' | 'CONCURRENCY_CONFLICT';
    };

// ─── Transition table ─────────────────────────────────────────────────────────

interface TransitionDef {
  /** Allowed source statuses. Empty = none (handled specially). */
  from: string[];
  /** Return error string to reject, or null to proceed. */
  guard?: (current: ConversationRow, event: TransitionEvent) => string | null;
  /** Compute the DB update set. Return null to skip DB update (e.g. INBOUND_MESSAGE). */
  update: (
    current: ConversationRow,
    event: TransitionEvent,
  ) => Record<string, unknown> | null;
  /** WHERE clause status match for optimistic concurrency. */
  whereStatus?: (event: TransitionEvent) => string;
  /** Extra WHERE conditions (e.g. onHold check). */
  extraWhere?: (current: ConversationRow) => boolean;
  /** Activity event to create after transition. */
  activity?: (
    current: ConversationRow,
    event: TransitionEvent,
  ) => {
    eventType: string;
    actor?: string;
    actorType?: 'user' | 'agent' | 'system';
    data?: Record<string, unknown>;
  };
  /** Extra SSE notifications beyond the default conversation notification. */
  notifications?: Array<{ table: string; action?: string }>;
}

function computeAutonomy(c: ConversationRow): string {
  return isAgentAssignee(c.assignee) ? 'full_ai' : 'human_assisted';
}

/** Shorthand for event field access without verbose casts. */
const ev = (e: TransitionEvent) => e as Record<string, unknown>;

const DASHBOARD_METRICS = [
  { table: 'conversations-dashboard', action: 'update' },
  { table: 'conversations-metrics', action: 'update' },
];

const TRANSITIONS: Record<string, TransitionDef> = {
  REASSIGN: {
    from: ['active'],
    guard: (c, e) =>
      c.assignee === ev(e).assignee
        ? 'Already assigned to this assignee'
        : null,
    update: (_c, e) => ({ assignee: ev(e).assignee, assignedAt: new Date() }),
    activity: (c, e) => ({
      eventType: 'handler.changed',
      actor: ev(e).userId as string,
      actorType: 'user',
      data: { from: c.assignee, to: ev(e).assignee, reason: ev(e).reason },
    }),
  },
  HOLD: {
    from: ['active'],
    extraWhere: (c) => !c.onHold,
    update: (_c, e) => ({
      onHold: true,
      heldAt: new Date(),
      holdReason: ev(e).reason,
    }),
    activity: (_c, e) => ({
      eventType: 'conversation.held',
      actor: ev(e).userId as string,
      actorType: 'user',
      data: { reason: ev(e).reason },
    }),
  },
  UNHOLD: {
    from: ['active'],
    update: () => ({ onHold: false, heldAt: null, holdReason: null }),
    activity: (_c, e) => ({
      eventType: 'conversation.unheld',
      actor: ev(e).userId as string,
      actorType: 'user',
    }),
  },
  RESOLVE: {
    from: ['active'],
    update: (c, e) => ({
      status: 'resolved',
      resolvedAt: new Date(),
      outcome: (ev(e).outcome as string) ?? 'resolved',
      autonomyLevel: computeAutonomy(c),
    }),
    activity: (_c, e) => ({
      eventType: 'conversation.resolved',
      actorType: 'system',
      data: { outcome: (ev(e).outcome as string) ?? 'resolved' },
    }),
    notifications: DASHBOARD_METRICS,
  },
  FAIL: {
    from: ['active'],
    update: () => ({ status: 'failed' }),
    activity: (_c, e) => ({
      eventType: 'conversation.failed',
      actorType: 'system',
      data: { reason: ev(e).reason },
    }),
    notifications: DASHBOARD_METRICS,
  },
  INBOUND_MESSAGE: {
    from: ['active'],
    update: () => null,
    activity: (_c, e) => ({
      eventType: 'message.inbound',
      actorType: 'system',
      data: {
        contactId: ev(e).contactId,
        content: (ev(e).content as string)?.slice(0, 200),
      },
    }),
  },
  SET_RESOLVING: {
    from: ['active'],
    update: () => ({ status: 'resolving' }),
  },
  GENERATION_DONE: {
    from: ['resolving'],
    whereStatus: () => 'resolving',
    update: (c, e) => ({
      status: 'resolved',
      resolvedAt: new Date(),
      outcome: (ev(e).outcome as string) ?? 'resolved',
      autonomyLevel: computeAutonomy(c),
    }),
    activity: (_c, e) => ({
      eventType: 'conversation.resolved',
      actorType: 'system',
      data: { outcome: (ev(e).outcome as string) ?? 'resolved' },
    }),
    notifications: DASHBOARD_METRICS,
  },
  RESOLVING_TIMEOUT: {
    from: ['resolving'],
    whereStatus: () => 'resolving',
    update: () => ({ status: 'failed' }),
    activity: () => ({
      eventType: 'conversation.failed',
      actorType: 'system',
      data: { reason: 'Resolving timeout — generation did not finish' },
    }),
    notifications: DASHBOARD_METRICS,
  },
  REOPEN: {
    from: ['resolved'],
    whereStatus: () => 'resolved',
    guard: (c, e) => {
      if (!c.resolvedAt) return null;
      const elapsed = Date.now() - c.resolvedAt.getTime();
      const ms = ev(e).idleWindowMs as number;
      return elapsed > ms
        ? `Idle window expired (${elapsed}ms > ${ms}ms)`
        : null;
    },
    update: (c) => ({
      status: 'active',
      resolvedAt: null,
      outcome: null,
      autonomyLevel: null,
      assignee: agentAssignee(c.agentId),
      assignedAt: null,
      onHold: false,
      heldAt: null,
      holdReason: null,
      reopenCount: c.reopenCount + 1,
    }),
    activity: (c) => ({
      eventType: 'conversation.reopened',
      actorType: 'system',
      data: { reopenCount: c.reopenCount + 1 },
    }),
    notifications: [{ table: 'conversations-dashboard', action: 'update' }],
  },
};

// ─── transition() ─────────────────────────────────────────────────────────────

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

  if (current.status === 'failed') {
    return {
      ok: false,
      error: `Event '${event.type}' is not valid in state 'failed'`,
      code: 'INVALID_TRANSITION',
    };
  }

  const def = TRANSITIONS[event.type];
  if (!def) {
    return {
      ok: false,
      error: 'Unknown event type',
      code: 'INVALID_TRANSITION',
    };
  }

  // Check source status
  if (!def.from.includes(current.status)) {
    return {
      ok: false,
      error: `Event '${event.type}' is not valid in state '${current.status}'`,
      code: 'INVALID_TRANSITION',
    };
  }

  // Run guard
  if (def.guard) {
    const guardError = def.guard(current, event);
    if (guardError) {
      return { ok: false, error: guardError, code: 'GUARD_FAILED' };
    }
  }

  const previousState = { status: current.status, assignee: current.assignee };
  const updateSet = def.update(current, event);

  let updated = current;

  // Apply DB update if needed
  if (updateSet !== null) {
    const whereStatus = def.whereStatus ? def.whereStatus(event) : 'active';
    const conditions = [
      eq(conversations.id, conversationId),
      eq(conversations.status, whereStatus),
    ];

    // Extra WHERE for HOLD (onHold must be false)
    if (def.extraWhere && !def.extraWhere(current)) {
      return {
        ok: false,
        error: 'Conversation state changed concurrently — retry the operation',
        code: 'CONCURRENCY_CONFLICT',
      };
    }

    if (event.type === 'HOLD') {
      conditions.push(eq(conversations.onHold, false));
    }

    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(conversations)
        .set(updateSet)
        .where(and(...conditions))
        .returning();
      return row ?? null;
    });

    if (!result) {
      return {
        ok: false,
        error: 'Conversation state changed concurrently — retry the operation',
        code: 'CONCURRENCY_CONFLICT',
      };
    }

    updated = result;
  }

  // Create activity message
  if (def.activity) {
    const act = def.activity(current, event);
    await createActivityMessage(db, realtime, {
      conversationId,
      eventType: act.eventType,
      actor: act.actor,
      actorType: act.actorType ?? 'system',
      data: act.data,
    });
  }

  // Emit extra notifications
  if (def.notifications) {
    for (const n of def.notifications) {
      await realtime.notify(n);
    }
  }

  // Default conversation notification
  await realtime.notify({
    table: 'conversations',
    id: conversationId,
    tab: computeTab(updated.status, updated.onHold),
    prevTab: computeTab(current.status, current.onHold),
  });

  return { ok: true, conversation: updated, previousState };
}
