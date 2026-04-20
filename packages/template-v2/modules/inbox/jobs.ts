/**
 * inbox module jobs.
 *
 * `inbox:wake-snoozed` — pg-boss `sendAfter` target fired when a snooze expires.
 * Payload: `{ conversationId, snoozedAt }`. The `snoozedAt` is the idempotency
 * key: the service compares it against the current row's `snoozedAt` column
 * and no-ops if they differ (i.e. staff re-snoozed or unsnoozed).
 *
 * The job handler itself lives here as a named function so tests can call it
 * directly without running a live worker. `server/entry.ts` binds it to
 * pg-boss at boot via `queue.work('inbox:wake-snoozed', wakeSnoozedJobHandler)`.
 */

export const WAKE_SNOOZED_JOB = 'inbox:wake-snoozed'

export interface WakeSnoozedPayload {
  conversationId: string
  /** ISO timestamp — idempotency key. Must equal `conversations.snoozed_at` when the job fires. */
  snoozedAt: string
}

export async function wakeSnoozedJobHandler(payload: WakeSnoozedPayload): Promise<{ woken: boolean }> {
  const { wakeSnoozed } = await import('./service/conversations')
  return wakeSnoozed(payload.conversationId, payload.snoozedAt)
}

export const jobs = [{ name: WAKE_SNOOZED_JOB, handler: wakeSnoozedJobHandler }] as const
