/**
 * `pause_schedule` — flip `automation_rules.enabled` for an existing schedule.
 * Used both to pause noisy heartbeats and to resume them when conditions
 * change. The cron-tick worker skips disabled rows entirely (per
 * `service/automations.listEnabled`), so toggling here is the full kill switch.
 */

import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

import { automationsService } from '../service/automations'

export const PauseAutomationInputSchema = Type.Object({
  scheduleId: Type.String({ minLength: 1 }),
  /** false to pause, true to resume. Defaults to false. */
  enabled: Type.Optional(Type.Boolean({ default: false })),
})

export type PauseAutomationToolInput = Static<typeof PauseAutomationInputSchema>

export const pauseAutomationTool = defineAgentTool({
  name: 'pause_schedule',
  description:
    'Pause (default) or resume a schedule by id. Disabled schedules are skipped by the cron-tick worker. Operator-only.',
  schema: PauseAutomationInputSchema,
  errorCode: 'SCHEDULE_ERROR',
  lane: 'standalone',
  prompt:
    'Pair with `create_schedule` for the full kill switch. Disabled schedules are skipped entirely until you re-enable them — use to silence noisy heartbeats or pause work during incidents.',
  async run(args) {
    const enabled = args.enabled ?? false
    await automationsService.setEnabled({ scheduleId: args.scheduleId, enabled })
    return { scheduleId: args.scheduleId, enabled }
  },
})
