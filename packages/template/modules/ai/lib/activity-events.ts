import type { RealtimeService, VobaseDb } from '@vobase/core';
import { logger } from '@vobase/core';

import { activityEvents } from '../schema';

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
): Promise<void> {
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
  } else {
    // Fire-and-forget tier — catch and log
    try {
      await target.insert(activityEvents).values(input);
      await realtime.notify({
        table: 'conversations-activity',
        action: 'insert',
      });
    } catch (err) {
      logger.warn('[activity-events] Failed to emit event (fire-and-forget)', {
        type: input.type,
        error: err,
      });
    }
  }
}
