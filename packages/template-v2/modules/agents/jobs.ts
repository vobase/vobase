/**
 * agents module job registry.
 *
 * Job-name constants are co-located here. `AGENT_WAKE_JOB` and
 * `SCHEDULED_FOLLOWUP_JOB` are the pg-boss queue names that
 * `wake-scheduler.ts` (producer) and `wake-worker.ts` (consumer) read +
 * write — the wake worker registers its own pg-boss handlers, so this
 * module does not declare `JobDef` entries for them.
 *
 * `agents:expire-approvals` is the recurring 15-minute sweeper that flips
 * pending-approval rows to `expired` once they outlive their TTL. Scheduled
 * via `ctx.scheduler.schedule()` during module init when a cron-capable
 * scheduler is available.
 */

import { expireOverdueApprovals, type JobDef } from '@vobase/core'

export const AGENT_WAKE_JOB = 'agents:agent-wake'
export const SCHEDULED_FOLLOWUP_JOB = 'agents:scheduled-followup'
export const EXPIRE_APPROVALS_JOB = 'agents:expire-approvals'
export const EXPIRE_APPROVALS_CRON = '*/15 * * * *'
export type AgentsJobName = typeof AGENT_WAKE_JOB | typeof SCHEDULED_FOLLOWUP_JOB | typeof EXPIRE_APPROVALS_JOB

export const jobs: JobDef[] = [
  {
    name: EXPIRE_APPROVALS_JOB,
    handler: async () => {
      await expireOverdueApprovals({ now: new Date(), batchSize: 200 })
    },
  },
]
