/**
 * Notification timeline events — sole entry point for cross-module callers
 * that need to record a staff ping in `harness.conversation_events`.
 *
 * `check:shape` (see `scripts/check-module-shape.ts`) bans direct writes to
 * `conversation_events` from anywhere outside `modules/messaging/service/**`,
 * so the team-module staff-ping path and any other dispatch site call
 * `recordNotificationSent` / `recordNotificationSuppressed` here instead of
 * inserting a row themselves. The events surface in the inbox activity
 * timeline (see `TIMELINE_ACTIVITY_TYPES` in `service/conversations.ts`).
 *
 * Both helpers are best-effort: when the journal service is not installed
 * (unit tests that bypass `runtime/bootstrap.ts`) we swallow the error and
 * keep the producer's transaction intact — the ping itself succeeded, the
 * timeline row is a side effect.
 */

import { journalGetLatestTurnIndex as getLatestTurnIndex } from '@vobase/core'

import type { AgentEvent } from '~/wake/events'
import { appendJournalEvent } from './journal'

/**
 * Kinds carried by the `notification.*` events. Mirrors the `PingKind` union
 * in `modules/team/service/staff-ping.ts` so the timeline payload stays
 * faithful to the originating dispatch.
 */
export type NotificationKind = 'mention' | 'approval' | 'proposal' | 'admin_alert'

export type NotificationChannel = 'whatsapp' | 'email'

export type NotificationSuppressionReason =
  | 'cooldown'
  | 'paused'
  | 'budget'
  | 'unverified'
  | 'offline'
  | 'verification_pending'

export interface RecordNotificationSentInput {
  conversationId: string
  organizationId: string
  kind: NotificationKind
  channel: NotificationChannel
  recipientStaffId: string
  recipientDisplayName: string
  /** `infra.channels_log` row id, for traceability back to the wire send. */
  messageId: string
}

export interface RecordNotificationSuppressedInput {
  conversationId: string
  organizationId: string
  kind: NotificationKind
  channel: NotificationChannel
  recipientStaffId: string
  recipientDisplayName: string
  suppressionReason: NotificationSuppressionReason
}

/** Drizzle tx handle — typed as `unknown` to mirror `appendJournalEvent`. */
type Tx = unknown

/**
 * Append a `notification.sent` row to the conversation timeline.
 *
 * Pass the producer's `tx` so the journal write lands in the same transaction
 * as the upstream ping bookkeeping (`pending_staff_pings`, `automation_runs`,
 * etc.). On failure the helper logs and returns — the ping itself is already
 * persisted by the caller, so we never roll their tx back over a timeline row.
 */
export async function recordNotificationSent(input: RecordNotificationSentInput, tx?: Tx): Promise<void> {
  try {
    const turnIndex = await getLatestTurnIndex(input.conversationId, tx)
    const event = {
      ts: new Date(),
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      turnIndex,
      type: 'notification.sent' as const,
      kind: input.kind,
      channel: input.channel,
      recipientStaffId: input.recipientStaffId,
      recipientDisplayName: input.recipientDisplayName,
      messageId: input.messageId,
    }
    await appendJournalEvent(
      {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        turnIndex,
        event: event as unknown as AgentEvent,
      },
      tx,
    )
  } catch (err) {
    console.warn(
      '[messaging/notification-events] notification.sent journal write skipped:',
      err instanceof Error ? err.message : err,
    )
  }
}

/**
 * Append a `notification.suppressed` row to the conversation timeline.
 *
 * Mirrors `recordNotificationSent` — same best-effort contract, same tx
 * threading. Used by the staff-ping path when cooldown / verification gating /
 * presence / pause checks short-circuit the WA send so customers can see WHY
 * a ping didn't fire, not just that it didn't.
 */
export async function recordNotificationSuppressed(input: RecordNotificationSuppressedInput, tx?: Tx): Promise<void> {
  try {
    const turnIndex = await getLatestTurnIndex(input.conversationId, tx)
    const event = {
      ts: new Date(),
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      turnIndex,
      type: 'notification.suppressed' as const,
      kind: input.kind,
      channel: input.channel,
      recipientStaffId: input.recipientStaffId,
      recipientDisplayName: input.recipientDisplayName,
      suppressionReason: input.suppressionReason,
    }
    await appendJournalEvent(
      {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        turnIndex,
        event: event as unknown as AgentEvent,
      },
      tx,
    )
  } catch (err) {
    console.warn(
      '[messaging/notification-events] notification.suppressed journal write skipped:',
      err instanceof Error ? err.message : err,
    )
  }
}
