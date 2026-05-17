/**
 * `vobase automations {list,enable,disable,run}` verb registrations.
 *
 * `run` bypasses the per-minute cron-tick idempotency check — it's the
 * explicit "fire one wake right now" knob a developer or agent uses to
 * validate a schedule's wiring without waiting for the next boundary.
 */

import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import { automationsService } from './service/automations'
import { getHeartbeatEmitter } from './service/heartbeat-emitter'

export const automationsListVerb = defineCliVerb({
  name: 'automations list',
  description: 'List automation rules in this organization (enabled and disabled).',
  audience: 'admin',
  input: z.object({}),
  body: async ({ ctx }) => {
    const rows = await automationsService.listAll({ organizationId: ctx.organizationId })
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

export const automationsEnableVerb = defineCliVerb({
  name: 'automations enable',
  description: 'Enable an automation rule (will participate in the next cron tick).',
  audience: 'admin',
  input: z.object({ id: z.string().min(1) }),
  body: async ({ input, ctx }) => {
    const row = await automationsService.getById(input.id)
    if (!row || row.organizationId !== ctx.organizationId) {
      return { ok: false as const, error: `automation not found: ${input.id}`, errorCode: 'not_found' }
    }
    await automationsService.setEnabled({ scheduleId: input.id, enabled: true })
    return { ok: true as const, data: { id: input.id, enabled: true } }
  },
  formatHint: 'json',
})

export const automationsDisableVerb = defineCliVerb({
  name: 'automations disable',
  description: 'Disable an automation rule.',
  audience: 'admin',
  input: z.object({ id: z.string().min(1) }),
  body: async ({ input, ctx }) => {
    const row = await automationsService.getById(input.id)
    if (!row || row.organizationId !== ctx.organizationId) {
      return { ok: false as const, error: `automation not found: ${input.id}`, errorCode: 'not_found' }
    }
    await automationsService.setEnabled({ scheduleId: input.id, enabled: false })
    return { ok: true as const, data: { id: input.id, enabled: false } }
  },
  formatHint: 'json',
})

export const automationsRunVerb = defineCliVerb({
  name: 'automations run',
  description: 'Force a single heartbeat tick for an automation rule (bypasses cron idempotency).',
  audience: 'admin',
  input: z.object({ id: z.string().min(1) }),
  body: async ({ input, ctx }) => {
    const row = await automationsService.getById(input.id)
    if (!row || row.organizationId !== ctx.organizationId) {
      return { ok: false as const, error: `automation not found: ${input.id}`, errorCode: 'not_found' }
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

export const automationsVerbs = [
  automationsListVerb,
  automationsEnableVerb,
  automationsDisableVerb,
  automationsRunVerb,
] as const
