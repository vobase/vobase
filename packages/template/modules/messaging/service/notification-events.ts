// Sole write path for notification.sent / notification.suppressed conversation events (check:shape).

import { journalGetLatestTurnIndex as getLatestTurnIndex, logger } from '@vobase/core'

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

type TimelineBase = {
  conversationId: string
  organizationId: string
  kind: NotificationKind
  channel: NotificationChannel
  recipientStaffId: string
  recipientDisplayName: string
}

async function appendTimelineEvent(
  tx: Tx,
  base: TimelineBase,
  extra:
    | { type: 'notification.sent'; messageId: string }
    | { type: 'notification.suppressed'; suppressionReason: NotificationSuppressionReason },
): Promise<void> {
  const turnIndex = await getLatestTurnIndex(base.conversationId, tx)
  const event = { ts: new Date(), turnIndex, ...base, ...extra }
  await appendJournalEvent(
    {
      conversationId: base.conversationId,
      organizationId: base.organizationId,
      turnIndex,
      event: event as unknown as AgentEvent,
    },
    tx,
  )
}

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
    await appendTimelineEvent(tx, input, { type: 'notification.sent', messageId: input.messageId })
  } catch (err) {
    logger.warn({ err }, '[messaging/notification-events] notification.sent journal write skipped')
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
    await appendTimelineEvent(tx, input, {
      type: 'notification.suppressed',
      suppressionReason: input.suppressionReason,
    })
  } catch (err) {
    logger.warn({ err }, '[messaging/notification-events] notification.suppressed journal write skipped')
  }
}
