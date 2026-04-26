/**
 * schedules module job registry.
 *
 * `schedules:cron-tick` is the recurring sweeper that lights up enabled
 * `agent_schedules` rows on their cron boundary and synthesises a heartbeat
 * trigger for each one. Idempotency keying is `(scheduleId, intendedRunAt)`
 * — multiple workers racing the same tick cannot double-fire because
 * `recordTick()` only succeeds on the first writer.
 *
 * Heartbeat emission delegates to the emitter installed by the agents module
 * via `setHeartbeatEmitter()`. Without an emitter the tick still runs, just
 * emits nothing — useful for tests that exercise schedule mutation only.
 */

import { tickSchedules } from '@modules/schedules/service/cron-tick'
import { getHeartbeatEmitter } from '@modules/schedules/service/heartbeat-emitter'
import type { JobDef } from '@vobase/core'

export const SCHEDULES_TICK_JOB = 'schedules:cron-tick'
export const SCHEDULES_TICK_CRON = '* * * * *'
export type SchedulesJobName = typeof SCHEDULES_TICK_JOB

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
    name: SCHEDULES_TICK_JOB,
    handler: async () => {
      await tickSchedules({
        emitHeartbeat: async (trigger) => {
          const emit = getHeartbeatEmitter()
          if (emit) await emit(trigger)
        },
      })
    },
  },
]
