import type { RealtimeService, VobaseDb } from '@vobase/core';
import { logger } from '@vobase/core';

import { activityEvents } from '../schema';

/**
 * Compute the inbox tab a conversation belongs to, given its current state.
 * - "attention": human/supervised/held modes, or has a pending escalation, or status is 'failed'
 * - "ai": mode is 'ai' and status is 'active'
 * - "done": status is 'completed' or 'resolved'
 */
export function computeTab(
  mode: string | null,
  status: string,
  hasPendingEscalation: boolean,
): 'attention' | 'ai' | 'done' {
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'attention';
  if (hasPendingEscalation) return 'attention';
  if (mode === 'human' || mode === 'supervised' || mode === 'held')
    return 'attention';
  return 'ai';
}

type ActivitySource = 'agent' | 'staff' | 'system';

interface EmitActivityEventInput {
  type: string;
  agentId?: string;
  userId?: string;
  source: ActivitySource;
  contactId?: string;
  conversationId?: string;
  channelRoutingId?: string;
  channelType?: string;
  data?: Record<string, unknown>;
  resolutionStatus?: 'pending' | null;
}

/**
 * Emit an activity event. Transactional (resolutionStatus non-null) throws on failure.
 * Fire-and-forget (null/undefined) catches and logs.
 */
export async function emitActivityEvent(
  db: VobaseDb,
  realtime: RealtimeService,
  input: EmitActivityEventInput,
  tx?: VobaseDb,
): Promise<string | null> {
  const isTransactional = input.resolutionStatus != null;
  const target = tx ?? db;

  if (isTransactional) {
    // Transactional tier — throw on failure
    const [row] = await target
      .insert(activityEvents)
      .values(input)
      .returning({ id: activityEvents.id });
    await realtime.notify(
      { table: 'conversations-activity', id: row.id, action: 'insert' },
      tx,
    );
    await realtime.notify(
      { table: 'conversations-attention', action: 'insert' },
      tx,
    );
    await realtime.notify(
      { table: 'conversations-dashboard', action: 'update' },
      tx,
    );
    return row.id;
  }

  // Fire-and-forget tier — catch and log
  try {
    const [row] = await target
      .insert(activityEvents)
      .values(input)
      .returning({ id: activityEvents.id });
    // When inside a transaction (tx provided), use tx for notify to avoid
    // PGlite deadlock (single-connection can't run db.execute inside db.transaction)
    await realtime.notify(
      { table: 'conversations-activity', action: 'insert' },
      tx,
    );
    return row.id;
  } catch (err) {
    logger.warn('[activity-events] Failed to emit event (fire-and-forget)', {
      type: input.type,
      error: err,
    });
    return null;
  }
}
