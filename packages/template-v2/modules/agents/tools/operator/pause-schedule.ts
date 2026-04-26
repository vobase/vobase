/**
 * `pause_schedule` — flip `agent_schedules.enabled` for an existing schedule.
 * Used both to pause noisy heartbeats and to resume them when conditions
 * change. The cron-tick worker skips disabled rows entirely (per
 * `service/schedules.listEnabled`), so toggling here is the full kill switch.
 */

import { schedules } from '@modules/schedules/service/schedules'
import { type Static, Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { AgentTool, ToolContext, ToolResult } from '@vobase/core'

export const PauseScheduleInputSchema = Type.Object({
  scheduleId: Type.String({ minLength: 1 }),
  /** false to pause, true to resume. Defaults to false. */
  enabled: Type.Optional(Type.Boolean({ default: false })),
})

export type PauseScheduleToolInput = Static<typeof PauseScheduleInputSchema>

export const pauseScheduleTool: AgentTool<PauseScheduleToolInput, { scheduleId: string; enabled: boolean }> = {
  name: 'pause_schedule',
  description:
    'Pause (default) or resume a schedule by id. Disabled schedules are skipped by the cron-tick worker. Operator-only.',
  inputSchema: PauseScheduleInputSchema,
  parallelGroup: 'never',

  async execute(args, _ctx: ToolContext): Promise<ToolResult<{ scheduleId: string; enabled: boolean }>> {
    if (!Value.Check(PauseScheduleInputSchema, args)) {
      const first = Value.Errors(PauseScheduleInputSchema, args).First()
      return {
        ok: false,
        error: `Invalid pause_schedule input — ${first ? `${first.path || 'root'}: ${first.message}` : 'unknown'}`,
        errorCode: 'VALIDATION_ERROR',
      }
    }
    const enabled = args.enabled ?? false
    try {
      await schedules.setEnabled({ scheduleId: args.scheduleId, enabled })
      return { ok: true, content: { scheduleId: args.scheduleId, enabled } }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'pause_schedule failed',
        errorCode: 'SCHEDULE_ERROR',
      }
    }
  },
}
