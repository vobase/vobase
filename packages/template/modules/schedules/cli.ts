/**
 * `vobase schedules {list,enable,disable,run}` verb registrations.
 *
 * `run` bypasses the per-minute cron-tick idempotency check — it's the
 * explicit "fire one wake right now" knob a developer or operator agent
 * uses to validate a schedule's wiring without waiting for the next boundary.
 */

import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import { getHeartbeatEmitter } from './service/heartbeat-emitter'
import { schedules as schedulesSvc } from './service/schedules'

export const schedulesListVerb = defineCliVerb({
  name: 'schedules list',
  description: 'List agent schedules in this organization (enabled and disabled).',
  input: z.object({}),
  body: async ({ ctx }) => {
    const rows = await schedulesSvc.listAll({ organizationId: ctx.organizationId })
    return {
      ok: true as const,
      data: rows.map((s) => ({
        id: s.id,
        agentId: s.agentId,
        slug: s.slug,
        cron: s.cron,
        timezone: s.timezone,
        enabled: s.enabled,
        lastTickAt: s.lastTickAt,
      })),
    }
  },
  formatHint: 'table:cols=id,agentId,slug,cron,timezone,enabled,lastTickAt',
})

export const schedulesEnableVerb = defineCliVerb({
  name: 'schedules enable',
  description: 'Enable a schedule (will participate in the next cron tick).',
  input: z.object({ id: z.string().min(1) }),
  body: async ({ input, ctx }) => {
    const row = await schedulesSvc.getById(input.id)
    if (!row || row.organizationId !== ctx.organizationId) {
      return { ok: false as const, error: `schedule not found: ${input.id}`, errorCode: 'not_found' }
    }
    await schedulesSvc.setEnabled({ scheduleId: input.id, enabled: true })
    return { ok: true as const, data: { id: input.id, enabled: true } }
  },
  formatHint: 'json',
})

export const schedulesDisableVerb = defineCliVerb({
  name: 'schedules disable',
  description: 'Disable a schedule.',
  input: z.object({ id: z.string().min(1) }),
  body: async ({ input, ctx }) => {
    const row = await schedulesSvc.getById(input.id)
    if (!row || row.organizationId !== ctx.organizationId) {
      return { ok: false as const, error: `schedule not found: ${input.id}`, errorCode: 'not_found' }
    }
    await schedulesSvc.setEnabled({ scheduleId: input.id, enabled: false })
    return { ok: true as const, data: { id: input.id, enabled: false } }
  },
  formatHint: 'json',
})

export const schedulesRunVerb = defineCliVerb({
  name: 'schedules run',
  description: 'Force a single heartbeat tick for a schedule (bypasses cron idempotency).',
  input: z.object({ id: z.string().min(1) }),
  body: async ({ input, ctx }) => {
    const row = await schedulesSvc.getById(input.id)
    if (!row || row.organizationId !== ctx.organizationId) {
      return { ok: false as const, error: `schedule not found: ${input.id}`, errorCode: 'not_found' }
    }
    const emitter = getHeartbeatEmitter()
    if (!emitter) {
      return { ok: false as const, error: 'heartbeat emitter not installed', errorCode: 'not_ready' }
    }
    const intendedRunAt = new Date()
    try {
      await emitter({
        kind: 'heartbeat',
        scheduleId: row.id,
        agentId: row.agentId,
        organizationId: row.organizationId,
        intendedRunAt: intendedRunAt.toISOString(),
        cron: row.cron,
      })
      return {
        ok: true as const,
        data: { id: row.id, agentId: row.agentId, intendedRunAt: intendedRunAt.toISOString() },
      }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'emit_failed',
      }
    }
  },
  formatHint: 'json',
})

export const schedulesVerbs = [schedulesListVerb, schedulesEnableVerb, schedulesDisableVerb, schedulesRunVerb] as const
