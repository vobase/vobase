/**
 * `create_schedule` — operator-side write to `agent_schedules`. The acting
 * agent is the schedule's owner: heartbeats fire as the operator that owns
 * the schedule, not as the agent that created it from a different role
 * context. Validates cron via the underlying service (which catches malformed
 * expressions on insert).
 */

import { schedules } from '@modules/schedules/service/schedules'
import { type Static, Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { AgentTool, ToolContext, ToolResult } from '@vobase/core'

export const CreateScheduleInputSchema = Type.Object({
  slug: Type.String({
    pattern: '^[a-z0-9-]+$',
    minLength: 1,
    maxLength: 64,
    description: 'Lowercase kebab-case slug, unique per org.',
  }),
  cron: Type.String({
    minLength: 9,
    maxLength: 120,
    description: 'Standard 5-field cron expression (e.g. "0 18 * * *").',
  }),
  timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64, default: 'UTC' })),
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
  /** If unset, defaults to the calling operator agent (`ctx.agentId`). */
  agentId: Type.Optional(Type.String({ minLength: 1 })),
})

export type CreateScheduleToolInput = Static<typeof CreateScheduleInputSchema>

export const createScheduleTool: AgentTool<CreateScheduleToolInput, { scheduleId: string }> = {
  name: 'create_schedule',
  description:
    'Create a recurring heartbeat schedule. Owner is the calling agent unless `agentId` is supplied. Operator-only.',
  inputSchema: CreateScheduleInputSchema,
  parallelGroup: 'never',

  async execute(args, ctx: ToolContext): Promise<ToolResult<{ scheduleId: string }>> {
    if (!Value.Check(CreateScheduleInputSchema, args)) {
      const first = Value.Errors(CreateScheduleInputSchema, args).First()
      return {
        ok: false,
        error: `Invalid create_schedule input — ${first ? `${first.path || 'root'}: ${first.message}` : 'unknown'}`,
        errorCode: 'VALIDATION_ERROR',
      }
    }
    try {
      const out = await schedules.create({
        organizationId: ctx.organizationId,
        agentId: args.agentId ?? ctx.agentId,
        slug: args.slug,
        cron: args.cron,
        timezone: args.timezone,
        config: args.notes ? { notes: args.notes } : undefined,
      })
      return { ok: true, content: { scheduleId: out.scheduleId } }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'create_schedule failed',
        errorCode: 'SCHEDULE_ERROR',
      }
    }
  },
}
