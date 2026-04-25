/**
 * messaging module jobs.
 *
 * `messaging:wake-snoozed` — pg-boss `sendAfter` target fired when a snooze expires.
 * Payload: `{ conversationId, snoozedAt }`. The `snoozedAt` is the idempotency
 * key: the service compares it against the current row's `snoozedAt` column
 * and no-ops if they differ (i.e. staff re-snoozed or unsnoozed).
 *
 * The job handler itself lives here as a named function so tests can call it
 * directly without running a live worker. The exported `jobs` array wraps it
 * in a void-returning adapter that satisfies core's `JobDef.handler` signature
 * (`(data: unknown) => Promise<void>`); Slice 4b's `collectJobs` pass binds
 * each entry to pg-boss at boot.
 */

import type { JobDef } from '@vobase/core'

import { wakeSnoozed } from './service/conversations'

export const WAKE_SNOOZED_JOB = 'messaging:wake-snoozed'

export interface WakeSnoozedPayload {
  conversationId: string
  /** ISO timestamp — idempotency key. Must equal `conversations.snoozed_at` when the job fires. */
  snoozedAt: string
}

export function wakeSnoozedJobHandler(payload: WakeSnoozedPayload): Promise<{ woken: boolean }> {
  return wakeSnoozed(payload.conversationId, payload.snoozedAt)
}

export const jobs: JobDef[] = [
  {
    name: WAKE_SNOOZED_JOB,
    handler: async (data) => {
      await wakeSnoozedJobHandler(data as WakeSnoozedPayload)
    },
  },
]
