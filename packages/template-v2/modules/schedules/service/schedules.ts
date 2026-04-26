/**
 * Sole write path for `schedules.agent_schedules`.
 *
 * Creating, enabling/disabling, and recording a tick all funnel through here
 * so the cron-tick worker, the operator UI, and seed paths converge on one
 * surface that can grow safe-boundary checks (cron validation, agent-exists,
 * etc.).
 */

import { agentSchedules, tickIdempotencyKey } from '@modules/schedules/schema'
import { and, eq, isNull, lt, or } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

export interface CreateScheduleInput {
  organizationId: string
  agentId: string
  slug: string
  cron: string
  timezone?: string
  config?: { notes?: string }
}

export interface RecordTickInput {
  scheduleId: string
  intendedRunAt: Date
}

export interface SchedulesService {
  create(input: CreateScheduleInput): Promise<{ scheduleId: string }>
  setEnabled(input: { scheduleId: string; enabled: boolean }): Promise<void>
  recordTick(input: RecordTickInput): Promise<{ idempotencyKey: string; firstFire: boolean }>
  listEnabled(input: {
    organizationId: string
  }): Promise<
    Array<{ id: string; agentId: string; slug: string; cron: string; timezone: string; lastTickAt: Date | null }>
  >
  /** All enabled schedules across every org — used by the global cron-tick driver. */
  listAllEnabled(): Promise<
    Array<{
      id: string
      organizationId: string
      agentId: string
      slug: string
      cron: string
      timezone: string
      lastTickAt: Date | null
    }>
  >
}

export interface SchedulesServiceDeps {
  db: ScopedDb
}

export function createSchedulesService(deps: SchedulesServiceDeps): SchedulesService {
  const db = deps.db

  return {
    async create(input) {
      const inserted = await db
        .insert(agentSchedules)
        .values({
          organizationId: input.organizationId,
          agentId: input.agentId,
          slug: input.slug,
          cron: input.cron,
          timezone: input.timezone ?? 'UTC',
          config: input.config,
          enabled: true,
        })
        .returning({ id: agentSchedules.id })
      const id = inserted[0]?.id
      if (!id) throw new Error('schedules.create: insert returned no row')
      return { scheduleId: id }
    },

    async setEnabled({ scheduleId, enabled }) {
      await db.update(agentSchedules).set({ enabled }).where(eq(agentSchedules.id, scheduleId))
    },

    async recordTick({ scheduleId, intendedRunAt }) {
      const idempotencyKey = tickIdempotencyKey(scheduleId, intendedRunAt)
      // Single-row update: only flip lastTickAt forward when the prospective tick is AHEAD of
      // the recorded one. Two writers racing the same boundary both target the same row, but
      // the second's WHERE filters out (its `lastTickAt` is no longer null/older), so RETURNING
      // is empty and we report `firstFire: false`. PG handles the null case via the OR branch.
      const updated = await db
        .update(agentSchedules)
        .set({ lastTickAt: intendedRunAt })
        .where(
          and(
            eq(agentSchedules.id, scheduleId),
            or(isNull(agentSchedules.lastTickAt), lt(agentSchedules.lastTickAt, intendedRunAt)),
          ),
        )
        .returning({ id: agentSchedules.id, lastTickAt: agentSchedules.lastTickAt })
      const row = updated[0]
      if (!row) return { idempotencyKey, firstFire: false }
      return { idempotencyKey, firstFire: true }
    },

    listEnabled({ organizationId }) {
      return db
        .select({
          id: agentSchedules.id,
          agentId: agentSchedules.agentId,
          slug: agentSchedules.slug,
          cron: agentSchedules.cron,
          timezone: agentSchedules.timezone,
          lastTickAt: agentSchedules.lastTickAt,
        })
        .from(agentSchedules)
        .where(and(eq(agentSchedules.organizationId, organizationId), eq(agentSchedules.enabled, true)))
    },

    listAllEnabled() {
      return db
        .select({
          id: agentSchedules.id,
          organizationId: agentSchedules.organizationId,
          agentId: agentSchedules.agentId,
          slug: agentSchedules.slug,
          cron: agentSchedules.cron,
          timezone: agentSchedules.timezone,
          lastTickAt: agentSchedules.lastTickAt,
        })
        .from(agentSchedules)
        .where(eq(agentSchedules.enabled, true))
    },
  }
}

let _currentService: SchedulesService | null = null
export function installSchedulesService(svc: SchedulesService): void {
  _currentService = svc
}
export function __resetSchedulesServiceForTests(): void {
  _currentService = null
}
function current(): SchedulesService {
  if (!_currentService) throw new Error('schedules: service not installed')
  return _currentService
}

export const schedules = {
  create: (input: CreateScheduleInput) => current().create(input),
  setEnabled: (input: { scheduleId: string; enabled: boolean }) => current().setEnabled(input),
  recordTick: (input: RecordTickInput) => current().recordTick(input),
  listEnabled: (input: { organizationId: string }) => current().listEnabled(input),
  listAllEnabled: () => current().listAllEnabled(),
}
