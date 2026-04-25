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
 */

import type { JobDef } from '@vobase/core'

export type { AgentsJobName } from './service/queue-jobs'
export { AGENT_WAKE_JOB, SCHEDULED_FOLLOWUP_JOB } from './service/queue-jobs'

export const jobs: JobDef[] = [
  { name: 'agents:agent-wake', handler: async () => {}, disabled: true },
  { name: 'agents:scheduled-followup', handler: async () => {}, disabled: true },
]
