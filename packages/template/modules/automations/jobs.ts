/**
 * automations module job registry.
 *
 * `automations:cron-tick` is the recurring sweeper that lights up enabled
 * `automation_rules` rows on their cron boundary and synthesises a heartbeat
 * trigger for each one. Idempotency keying is `(scheduleId, intendedRunAt)`
 * — multiple workers racing the same tick cannot double-fire because
 * `recordTick()` only succeeds on the first writer.
 *
 * Heartbeat emission delegates to the emitter installed by the agents module
 * via `setHeartbeatEmitter()`. Without an emitter the tick still runs, just
 * emits nothing — useful for tests that exercise schedule mutation only.
 */

import { tickCron } from '@modules/automations/service/cron-tick'
import { getHeartbeatEmitter } from '@modules/automations/service/heartbeat-emitter'
import { runAutomationRunsPrune } from '@modules/automations/service/runs-prune-job'
import { listOrgsWithSetting } from '@modules/settings/service/org-settings'
import type { JobDef } from '@vobase/core'

export const AUTOMATIONS_TICK_JOB = 'automations:cron-tick'
export const AUTOMATIONS_TICK_CRON = '* * * * *'

/**
 * Nightly retention sweep for `automation_runs` (US-015 / Slice D.3).
 * Runs at 03:00 UTC; sole writer of DELETEs on the runs table.
 */
export const AUTOMATIONS_RUNS_PRUNE_JOB = 'automations:runs-prune'
export const AUTOMATIONS_RUNS_PRUNE_CRON = '0 3 * * *'

export type AutomationsJobName = typeof AUTOMATIONS_TICK_JOB | typeof AUTOMATIONS_RUNS_PRUNE_JOB

/** Heartbeat trigger shape — emitted into the wake pipeline once per tick. */
export interface HeartbeatTrigger {
  kind: 'heartbeat'
  scheduleId: string
  agentId: string
  organizationId: string
  intendedRunAt: string
  /** Cron expression that produced this tick (for diagnostics). */
  cron: string
}

export const jobs: JobDef[] = [
  {
    name: AUTOMATIONS_TICK_JOB,
    handler: async () => {
      await tickCron({
        emitHeartbeat: async (trigger) => {
          const emit = getHeartbeatEmitter()
          if (emit) await emit(trigger)
        },
        disabledOrgIds: () => listOrgsWithSetting('operatorHeartbeatEnabled', 'false'),
      })
    },
  },
  {
    name: AUTOMATIONS_RUNS_PRUNE_JOB,
    handler: async () => {
      await runAutomationRunsPrune()
    },
  },
]
