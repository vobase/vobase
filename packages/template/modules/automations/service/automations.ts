/**
 * Sole write path for `automations.automations` and `automations.automation_rules`.
 *
 * Originally seeded in US-002 as a thin wrapper over `automation_rules` (cron
 * mutations + tick recording). US-013 extends it with rule-level CRUD over the
 * `automations` table: `createRule`, `updateRule`, `pauseRule`, `resumeRule`.
 *
 * `pauseRule` / `resumeRule` / `setBudget` (in `budget-caps.ts`) write an
 * `audit.audit_log` row inside the same Postgres tx as the row mutation —
 * rollback ⇒ no audit leak.
 *
 * The exported service const is `automationsService` (not bare `automations`)
 * to avoid identifier collision with the Drizzle table also named `automations`
 * in this module.
 */

import { automationRules, automations, tickIdempotencyKey } from '@modules/automations/schema'
import { auditLog } from '@vobase/core'
import { and, eq, isNull, lt, or } from 'drizzle-orm'

import { type RealtimeService, type ScopedDb, safeNotify, type Tx } from '~/runtime'

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

// ─── US-013 rule CRUD types ──────────────────────────────────────────────────

export interface Actor {
  id: string
  kind: 'user' | 'system'
}

/** Stable system-actor used by the budget watcher and other automated pausers. */
export const SYSTEM_BUDGET_WATCHER_ACTOR: Actor = { id: 'system:budget-watcher', kind: 'system' }

export interface AutomationActionInput {
  type: 'wake'
  agentId: string
  lane: 'standalone' | 'conversation'
}

export interface CreateRuleSpec {
  organizationId: string
  name: string
  /** Must be a key from `eventRegistry`. */
  eventName: string
  action: AutomationActionInput
  paused?: boolean
  /** Required for `eventName === 'cron'`; ignored otherwise. */
  cron?: string
}

export interface UpdateRulePatch {
  name?: string
  action?: AutomationActionInput
  paused?: boolean
  pausedReason?: string | null
  cron?: string | null
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

  // ─── US-013: rule CRUD over the `automations` table ───────────────────────
  createRule(spec: CreateRuleSpec): Promise<string>
  updateRule(ruleId: string, patch: UpdateRulePatch): Promise<void>
  pauseRule(ruleId: string, reason: string, opts: { actor: Actor }): Promise<void>
  resumeRule(ruleId: string, opts: { actor: Actor }): Promise<void>
  /** Read a single rule from the `automations` table (used by dispatcher + tests). */
  getRuleById(ruleId: string): Promise<
    | {
        id: string
        organizationId: string
        name: string
        eventName: string
        action: { type: 'wake' | 'webhook'; agentId?: string; lane?: 'conversation' | 'standalone' }
        paused: boolean
        pausedReason: string | null
        cron: string | null
      }
    | undefined
  >
  /** All rules whose `event_name` matches and that are NOT paused. Read-side for the dispatcher. */
  listRulesForEvent(
    eventName: string,
    organizationId?: string,
  ): Promise<
    Array<{
      id: string
      organizationId: string
      name: string
      eventName: string
      action: { type: 'wake' | 'webhook'; agentId?: string; lane?: 'conversation' | 'standalone' }
      paused: boolean
      cron: string | null
    }>
  >
}

export interface AutomationsServiceDeps {
  db: ScopedDb
  /**
   * Optional realtime handle — when provided, pauseRule/resumeRule emit a
   * `pg_notify` after commit so the `/automations` dashboard's
   * AutomationsTable refetches without a manual reload. Omit in tests that
   * don't exercise SSE.
   */
  realtime?: RealtimeService
}

export function createAutomationsService(deps: AutomationsServiceDeps): AutomationsService {
  const db = deps.db
  const realtime = deps.realtime

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

    // ─── US-013: rule CRUD ──────────────────────────────────────────────────

    async createRule(spec) {
      const inserted = await db
        .insert(automations)
        .values({
          organizationId: spec.organizationId,
          name: spec.name,
          eventName: spec.eventName,
          action: spec.action,
          paused: spec.paused ?? false,
          cron: spec.cron ?? null,
        })
        .returning({ id: automations.id })
      const id = inserted[0]?.id
      if (!id) throw new Error('automations.createRule: insert returned no row')
      return id
    },

    async updateRule(ruleId, patch) {
      const set: Record<string, unknown> = {}
      if (patch.name !== undefined) set.name = patch.name
      if (patch.action !== undefined) set.action = patch.action
      if (patch.paused !== undefined) set.paused = patch.paused
      if (patch.pausedReason !== undefined) set.pausedReason = patch.pausedReason
      if (patch.cron !== undefined) set.cron = patch.cron
      if (Object.keys(set).length === 0) return
      await db.update(automations).set(set).where(eq(automations.id, ruleId))
    },

    async pauseRule(ruleId, reason, opts) {
      // Wrap UPDATE + audit_log INSERT in one tx so a rollback leaves no
      // audit leak. The UPDATE…RETURNING gives us the orgId for the audit row
      // without a separate SELECT.
      const txDb = db as unknown as { transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> }
      let notifyId: string | null = null
      await txDb.transaction(async (tx) => {
        const t = tx as unknown as typeof db
        const updated = await t
          .update(automations)
          .set({
            paused: true,
            pausedReason: reason,
            pausedAt: new Date(),
          })
          .where(eq(automations.id, ruleId))
          .returning({
            id: automations.id,
            organizationId: automations.organizationId,
            name: automations.name,
          })
        const row = updated[0]
        if (!row) return // nothing to audit when no row was matched
        await t.insert(auditLog).values({
          event: 'automations.paused',
          actorId: opts.actor.id,
          details: JSON.stringify({
            actorKind: opts.actor.kind,
            targetId: `${row.organizationId}:${row.id}`,
            organizationId: row.organizationId,
            ruleId: row.id,
            ruleName: row.name,
            reason,
          }),
        })
        notifyId = row.id
      })
      if (realtime && notifyId) {
        safeNotify(realtime, { table: 'automations', id: notifyId, action: 'paused' })
      }
    },

    async resumeRule(ruleId, opts) {
      const txDb = db as unknown as { transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> }
      let notifyId: string | null = null
      await txDb.transaction(async (tx) => {
        const t = tx as unknown as typeof db
        const updated = await t
          .update(automations)
          .set({
            paused: false,
            pausedReason: null,
            pausedAt: null,
          })
          .where(eq(automations.id, ruleId))
          .returning({
            id: automations.id,
            organizationId: automations.organizationId,
            name: automations.name,
          })
        const row = updated[0]
        if (!row) return
        await t.insert(auditLog).values({
          event: 'automations.resumed',
          actorId: opts.actor.id,
          details: JSON.stringify({
            actorKind: opts.actor.kind,
            targetId: `${row.organizationId}:${row.id}`,
            organizationId: row.organizationId,
            ruleId: row.id,
            ruleName: row.name,
          }),
        })
        notifyId = row.id
      })
      if (realtime && notifyId) {
        safeNotify(realtime, { table: 'automations', id: notifyId, action: 'resumed' })
      }
    },

    async getRuleById(ruleId) {
      const rows = await db
        .select({
          id: automations.id,
          organizationId: automations.organizationId,
          name: automations.name,
          eventName: automations.eventName,
          action: automations.action,
          paused: automations.paused,
          pausedReason: automations.pausedReason,
          cron: automations.cron,
        })
        .from(automations)
        .where(eq(automations.id, ruleId))
        .limit(1)
      return rows[0]
    },

    async listRulesForEvent(eventName, organizationId) {
      const where = organizationId
        ? and(eq(automations.eventName, eventName), eq(automations.organizationId, organizationId))
        : eq(automations.eventName, eventName)
      const rows = await db
        .select({
          id: automations.id,
          organizationId: automations.organizationId,
          name: automations.name,
          eventName: automations.eventName,
          action: automations.action,
          paused: automations.paused,
          cron: automations.cron,
        })
        .from(automations)
        .where(where)
      return rows
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
  createRule: (spec: CreateRuleSpec) => current().createRule(spec),
  updateRule: (ruleId: string, patch: UpdateRulePatch) => current().updateRule(ruleId, patch),
  pauseRule: (ruleId: string, reason: string, opts: { actor: Actor }) => current().pauseRule(ruleId, reason, opts),
  resumeRule: (ruleId: string, opts: { actor: Actor }) => current().resumeRule(ruleId, opts),
  getRuleById: (ruleId: string) => current().getRuleById(ruleId),
  listRulesForEvent: (eventName: string, organizationId?: string) =>
    current().listRulesForEvent(eventName, organizationId),
}
