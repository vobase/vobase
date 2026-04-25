/**
 * agents module job registry.
 *
 * `agents:agent-wake` / `agents:scheduled-followup` are placeholders pending
 * the `createWakeWorker` audit (Slice 4b §12.1): grep shows
 * `createWakeWorker(...).start()` is only called from tests, so the
 * production registration path may be dead. They ship with `disabled: true`
 * + no-op handlers so they satisfy `JobDef` but are skipped by core's
 * `collectJobs` pass — if the audit finds a live consumer, flip `disabled`
 * off and wire real handlers here.
 *
 * Job-name constants are co-located here (used by `wake-scheduler.ts` and
 * `wake-worker.ts` to send/receive on the canonical pg-boss queues).
 */

import type { JobDef } from '@vobase/core'

export const AGENT_WAKE_JOB = 'agents:agent-wake'
export const SCHEDULED_FOLLOWUP_JOB = 'agents:scheduled-followup'
export type AgentsJobName = typeof AGENT_WAKE_JOB | typeof SCHEDULED_FOLLOWUP_JOB

export const jobs: JobDef[] = [
  { name: AGENT_WAKE_JOB, handler: async () => {}, disabled: true },
  { name: SCHEDULED_FOLLOWUP_JOB, handler: async () => {}, disabled: true },
]
