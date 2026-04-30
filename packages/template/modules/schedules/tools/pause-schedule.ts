/**
 * `pause_schedule` — flip `agent_schedules.enabled` for an existing schedule.
 * Used both to pause noisy heartbeats and to resume them when conditions
 * change. The cron-tick worker skips disabled rows entirely (per
 * `service/schedules.listEnabled`), so toggling here is the full kill switch.
 */

import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

import { schedules } from '../service/schedules'

export const PauseScheduleInputSchema = Type.Object({
  scheduleId: Type.String({ minLength: 1 }),
  /** false to pause, true to resume. Defaults to false. */
  enabled: Type.Optional(Type.Boolean({ default: false })),
})

export type PauseScheduleToolInput = Static<typeof PauseScheduleInputSchema>

export const pauseScheduleTool = defineAgentTool({
  name: 'pause_schedule',
  description:
    'Pause (default) or resume a schedule by id. Disabled schedules are skipped by the cron-tick worker. Operator-only.',
  schema: PauseScheduleInputSchema,
  errorCode: 'SCHEDULE_ERROR',
  lane: 'standalone',
  prompt:
    'Pair with `create_schedule` for the full kill switch. Disabled schedules are skipped entirely until you re-enable them — use to silence noisy heartbeats or pause work during incidents.',
  async run(args) {
    const enabled = args.enabled ?? false
    await schedules.setEnabled({ scheduleId: args.scheduleId, enabled })
    return { scheduleId: args.scheduleId, enabled }
  },
})
