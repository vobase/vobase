/**
 * Sole write path for `automations.automation_rules`.
 *
 * Creating, enabling/disabling, and recording a tick all funnel through here
 * so the cron-tick worker, the operator UI, and seed paths converge on one
 * surface that can grow safe-boundary checks (cron validation, agent-exists,
 * etc.).
 *
 * Renamed from `schedules.service.schedules` in US-005. The exported service
 * const is `automationsService` (not bare `automations`) to avoid identifier
 * collision with the Drizzle table also named `automations` in this module.
 */

import { automationRules, tickIdempotencyKey } from '@modules/automations/schema'
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

export interface AutomationsService {
  create(input: CreateScheduleInput): Promise<{ scheduleId: string }>
  setEnabled(input: { scheduleId: string; enabled: boolean }): Promise<void>
  recordTick(input: RecordTickInput): Promise<{ idempotencyKey: string; firstFire: boolean }>
  listEnabled(input: {
    organizationId: string
  }): Promise<
    Array<{ id: string; agentId: string; slug: string; cron: string; timezone: string; lastTickAt: Date | null }>
  >
  /** All schedules (enabled + disabled) for an org — used by the operator-facing CLI list verb. */
  listAll(input: { organizationId: string }): Promise<
    Array<{
      id: string
      agentId: string
      slug: string
      cron: string
      timezone: string
      enabled: boolean
      lastTickAt: Date | null
    }>
  >
  /** Single-row read — returned by the CLI enable/disable verbs to confirm the new state. */
  getById(scheduleId: string): Promise<
    | {
        id: string
        organizationId: string
        agentId: string
        slug: string
        cron: string
        timezone: string
        enabled: boolean
        lastTickAt: Date | null
      }
    | undefined
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

export interface AutomationsServiceDeps {
  db: ScopedDb
}

export function createAutomationsService(deps: AutomationsServiceDeps): AutomationsService {
  const db = deps.db

  return {
    async create(input) {
      const inserted = await db
        .insert(automationRules)
        .values({
          organizationId: input.organizationId,
          agentId: input.agentId,
          slug: input.slug,
          cron: input.cron,
          timezone: input.timezone ?? 'UTC',
          config: input.config,
          enabled: true,
        })
        .returning({ id: automationRules.id })
      const id = inserted[0]?.id
      if (!id) throw new Error('automations.create: insert returned no row')
      return { scheduleId: id }
    },

    async setEnabled({ scheduleId, enabled }) {
      await db.update(automationRules).set({ enabled }).where(eq(automationRules.id, scheduleId))
    },

    async recordTick({ scheduleId, intendedRunAt }) {
      const idempotencyKey = tickIdempotencyKey(scheduleId, intendedRunAt)
      // Single-row update: only flip lastTickAt forward when the prospective tick is AHEAD of
      // the recorded one. Two writers racing the same boundary both target the same row, but
      // the second's WHERE filters out (its `lastTickAt` is no longer null/older), so RETURNING
      // is empty and we report `firstFire: false`. PG handles the null case via the OR branch.
      const updated = await db
        .update(automationRules)
        .set({ lastTickAt: intendedRunAt })
        .where(
          and(
            eq(automationRules.id, scheduleId),
            or(isNull(automationRules.lastTickAt), lt(automationRules.lastTickAt, intendedRunAt)),
          ),
        )
        .returning({ id: automationRules.id, lastTickAt: automationRules.lastTickAt })
      const row = updated[0]
      if (!row) return { idempotencyKey, firstFire: false }
      return { idempotencyKey, firstFire: true }
    },

    listEnabled({ organizationId }) {
      return db
        .select({
          id: automationRules.id,
          agentId: automationRules.agentId,
          slug: automationRules.slug,
          cron: automationRules.cron,
          timezone: automationRules.timezone,
          lastTickAt: automationRules.lastTickAt,
        })
        .from(automationRules)
        .where(and(eq(automationRules.organizationId, organizationId), eq(automationRules.enabled, true)))
    },

    listAllEnabled() {
      return db
        .select({
          id: automationRules.id,
          organizationId: automationRules.organizationId,
          agentId: automationRules.agentId,
          slug: automationRules.slug,
          cron: automationRules.cron,
          timezone: automationRules.timezone,
          lastTickAt: automationRules.lastTickAt,
        })
        .from(automationRules)
        .where(eq(automationRules.enabled, true))
    },

    listAll({ organizationId }) {
      return db
        .select({
          id: automationRules.id,
          agentId: automationRules.agentId,
          slug: automationRules.slug,
          cron: automationRules.cron,
          timezone: automationRules.timezone,
          enabled: automationRules.enabled,
          lastTickAt: automationRules.lastTickAt,
        })
        .from(automationRules)
        .where(eq(automationRules.organizationId, organizationId))
    },

    async getById(scheduleId) {
      const rows = await db
        .select({
          id: automationRules.id,
          organizationId: automationRules.organizationId,
          agentId: automationRules.agentId,
          slug: automationRules.slug,
          cron: automationRules.cron,
          timezone: automationRules.timezone,
          enabled: automationRules.enabled,
          lastTickAt: automationRules.lastTickAt,
        })
        .from(automationRules)
        .where(eq(automationRules.id, scheduleId))
        .limit(1)
      return rows[0]
    },
  }
}

let _currentService: AutomationsService | null = null
export function installAutomationsService(svc: AutomationsService): void {
  _currentService = svc
}
export function __resetAutomationsServiceForTests(): void {
  _currentService = null
}
function current(): AutomationsService {
  if (!_currentService) throw new Error('automations: service not installed')
  return _currentService
}

export const automationsService = {
  create: (input: CreateScheduleInput) => current().create(input),
  setEnabled: (input: { scheduleId: string; enabled: boolean }) => current().setEnabled(input),
  recordTick: (input: RecordTickInput) => current().recordTick(input),
  listEnabled: (input: { organizationId: string }) => current().listEnabled(input),
  listAll: (input: { organizationId: string }) => current().listAll(input),
  getById: (scheduleId: string) => current().getById(scheduleId),
  listAllEnabled: () => current().listAllEnabled(),
}
