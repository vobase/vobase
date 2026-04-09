/**
 * Channel session management — tracks messaging window state.
 *
 * WhatsApp enforces a 24-hour messaging window after the last inbound message.
 * This module tracks window open/close state per interaction + channel instance.
 */
import type { VobaseDb } from '@vobase/core';
import { and, eq, lt } from 'drizzle-orm';

import { channelSessions } from '../schema';

const WINDOW_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Upsert a channel session on inbound message.
 * Refreshes the window: windowOpensAt=now, windowExpiresAt=now+24h, sessionState='window_open'.
 */
export async function upsertSession(
  db: VobaseDb,
  params: {
    interactionId: string;
    channelInstanceId: string;
    channelType: string;
  },
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + WINDOW_DURATION_MS);

  await db
    .insert(channelSessions)
    .values({
      interactionId: params.interactionId,
      channelInstanceId: params.channelInstanceId,
      channelType: params.channelType,
      sessionState: 'window_open',
      windowOpensAt: now,
      windowExpiresAt: expiresAt,
    })
    .onConflictDoUpdate({
      target: [
        channelSessions.interactionId,
        channelSessions.channelInstanceId,
      ],
      set: {
        sessionState: 'window_open',
        windowOpensAt: now,
        windowExpiresAt: expiresAt,
        updatedAt: now,
      },
    });
}

/**
 * Check if a messaging window is open for an interaction.
 * Returns { isOpen, expiresAt } based on the most recent session record.
 */
export async function checkWindow(
  db: VobaseDb,
  interactionId: string,
): Promise<{ isOpen: boolean; expiresAt: Date | null }> {
  const [session] = await db
    .select({
      sessionState: channelSessions.sessionState,
      windowExpiresAt: channelSessions.windowExpiresAt,
    })
    .from(channelSessions)
    .where(eq(channelSessions.interactionId, interactionId))
    .limit(1);

  if (!session) {
    return { isOpen: false, expiresAt: null };
  }

  // Double-check actual expiry time in case cron hasn't run yet
  const now = new Date();
  if (session.sessionState === 'window_open' && session.windowExpiresAt > now) {
    return { isOpen: true, expiresAt: session.windowExpiresAt };
  }

  return { isOpen: false, expiresAt: session.windowExpiresAt };
}

/**
 * Bulk-expire sessions where the window has passed.
 * Called by the session-expiry cron job.
 */
export async function expireSessions(db: VobaseDb): Promise<number> {
  const now = new Date();
  const result = await db
    .update(channelSessions)
    .set({ sessionState: 'window_expired', updatedAt: now })
    .where(
      and(
        eq(channelSessions.sessionState, 'window_open'),
        lt(channelSessions.windowExpiresAt, now),
      ),
    )
    .returning({ id: channelSessions.id });

  return result.length;
}
