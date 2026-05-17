/**
 * automations module job registry.
 *
 * `automations:cron-tick` is the recurring sweeper that will replace
 * `schedules:cron-tick` once US-005 completes the schedules→automations
 * migration. The handler is a no-op for US-002.
 *
 * US-005 wires this to tickCron once schedules→automations migration completes.
 */

import type { JobDef } from '@vobase/core'

export const AUTOMATIONS_TICK_JOB = 'automations:cron-tick'
export const AUTOMATIONS_TICK_CRON = '* * * * *'
export type AutomationsJobName = typeof AUTOMATIONS_TICK_JOB

/** Heartbeat trigger shape — re-exported from schedules for cross-module compatibility. */
export interface HeartbeatTrigger {
  kind: 'heartbeat'
  scheduleId: string
  agentId: string
  organizationId: string
  intendedRunAt: string
  /** Cron expression that produced this tick (for diagnostics). */
  cron: string
}

// TODO: US-005 wires this to tickCron once schedules→automations migration completes.
export const jobs: JobDef[] = [
  {
    name: AUTOMATIONS_TICK_JOB,
    handler: async () => {
      // No-op until US-005 ports cron-tick logic from schedules module.
    },
  },
]
