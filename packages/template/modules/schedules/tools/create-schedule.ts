/**
 * `create_schedule` — operator-side write to `agent_schedules`. The acting
 * agent is the schedule's owner: heartbeats fire as the operator that owns
 * the schedule, not as the agent that created it from a different role
 * context. Validates cron via the underlying service (which catches malformed
 * expressions on insert).
 */

import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

import { schedules } from '../service/schedules'

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
  /** If unset, defaults to the calling agent (`ctx.agentId`). */
  agentId: Type.Optional(Type.String({ minLength: 1 })),
})

export type CreateScheduleToolInput = Static<typeof CreateScheduleInputSchema>

export const createScheduleTool = defineAgentTool({
  name: 'create_schedule',
  description:
    'Create a recurring heartbeat schedule. Owner is the calling agent unless `agentId` is supplied. Operator-only.',
  schema: CreateScheduleInputSchema,
  errorCode: 'SCHEDULE_ERROR',
  lane: 'standalone',
  prompt:
    "Use for recurring work — daily review-and-plan, weekly inbox sweeps, end-of-shift summaries. Cron is standard 5-field. Heartbeats fire as the schedule's owner agent (not the agent that created it).",
  async run(args, ctx) {
    const out = await schedules.create({
      organizationId: ctx.organizationId,
      agentId: args.agentId ?? ctx.agentId,
      slug: args.slug,
      cron: args.cron,
      timezone: args.timezone,
      config: args.notes ? { notes: args.notes } : undefined,
    })
    return { scheduleId: out.scheduleId }
  },
})
