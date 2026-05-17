/**
 * `automations` module schema.
 *
 * Owns four tables in the `automations` pgSchema:
 *
 * - `automations`        — rule table: event → action mapping with pause support.
 * - `automation_runs`    — history: one row per rule execution.
 * - `tenant_budget_caps` — per-org daily USD spend cap (cents).
 * - `automation_rules`   — rename target of `schedules.agent_schedules`; same
 *                          column shape, new home post-US-005 migration.
 *
 * Cross-schema FKs to `agents.agent_definitions(id)` are enforced post-push
 * (drizzle-kit push doesn't span pgSchemas in a single graph).
 */

import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { automationsPgSchema } from '~/runtime'

// ─── Shared type exports ─────────────────────────────────────────────────────

/** Action payload stored on each `automations` rule row. */
export interface AutomationAction {
  type: 'wake' | 'webhook'
  /** FK to agents.agent_definitions — required when type = 'wake'. */
  agentId?: string
  /** Wake lane — defaults to 'standalone' when omitted. */
  lane?: 'conversation' | 'standalone'
  /** Outbound HTTP endpoint — required when type = 'webhook'. */
  webhookUrl?: string
}

// ─── automations ─────────────────────────────────────────────────────────────

/** Event-driven automation rule: one row per (org, name) trigger–action pair. */
export const automations = automationsPgSchema.table(
  'automations',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    /** Human-readable rule name; unique per org. */
    name: text('name').notNull(),
    /** Event discriminator that triggers the rule (e.g. 'cron', 'message:created'). */
    eventName: text('event_name').notNull(),
    /** Closed action payload — see `AutomationAction`. */
    action: jsonb('action').notNull().$type<AutomationAction>(),
    /** When true the rule is silenced; new runs are recorded as suppressed_paused. */
    paused: boolean('paused').notNull().default(false),
    /** Human-readable reason set by the operator when pausing. */
    pausedReason: text('paused_reason'),
    /** UTC timestamp of the last pause event. */
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    /** 5-field cron string — only set when eventName = 'cron'. */
    cron: text('cron'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uq_automations_org_name').on(t.organizationId, t.name),
    index('idx_automations_event_paused').on(t.eventName, t.paused),
    check('automations_action_type_check', sql`action->>'type' IN ('wake', 'webhook')`),
  ],
)

// ─── automation_runs ──────────────────────────────────────────────────────────

/** Valid terminal + in-flight statuses for an automation run. */
export type AutomationRunStatus =
  | 'queued'
  | 'succeeded'
  | 'failed'
  | 'suppressed_cooldown'
  | 'suppressed_paused'
  | 'suppressed_budget'
  | 'suppressed_unverified'

/** History record — one row per rule execution attempt. */
export const automationRuns = automationsPgSchema.table(
  'automation_runs',
  {
    id: nanoidPrimaryKey(),
    /** FK to automations.automations(id). */
    ruleId: text('rule_id').notNull(),
    organizationId: text('organization_id').notNull(),
    /** Snapshot of the event name that triggered this run. */
    eventName: text('event_name').notNull(),
    /** Run lifecycle status — see `AutomationRunStatus`. */
    status: text('status').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Wall-clock duration in milliseconds. */
    durationMs: integer('duration_ms'),
    errorMessage: text('error_message'),
    /** Snapshot of the event payload at dispatch time, for diagnostics. */
    payloadSnapshot: jsonb('payload_snapshot'),
    /** FK to harness.active_wakes(id) when action.type = 'wake'. */
    wakeId: text('wake_id'),
  },
  (t) => [
    index('idx_automation_runs_rule').on(t.ruleId, t.startedAt),
    index('idx_automation_runs_org').on(t.organizationId, t.startedAt),
    index('idx_automation_runs_status').on(t.status, t.startedAt),
    check(
      'automation_runs_status_check',
      sql`status IN ('queued','succeeded','failed','suppressed_cooldown','suppressed_paused','suppressed_budget','suppressed_unverified')`,
    ),
  ],
)

// ─── tenant_budget_caps ───────────────────────────────────────────────────────

/** Per-org daily USD spend cap. Amount stored as INTEGER cents (§ data conventions). */
export const tenantBudgetCaps = automationsPgSchema.table('tenant_budget_caps', {
  organizationId: text('organization_id').primaryKey(),
  /** Daily cap in cents — e.g. 500 = $5.00. */
  dailyCapUsd: integer('daily_cap_usd').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

// ─── automation_rules ────────────────────────────────────────────────────────

/**
 * Rename target of `schedules.agent_schedules`.
 *
 * Column shape is intentionally identical to `modules/schedules/schema.ts::agentSchedules`
 * so US-005 can perform a schema rename without a data migration.
 *
 * US-005 will INSERT INTO automations SELECT id, name, 'cron', jsonb_build_object('type','wake','agentId',agent_id,'lane','standalone'), paused, ...
 * FROM automation_rules — but only AFTER agent_schedules→automation_rules rename.
 */
export const automationRules = automationsPgSchema.table(
  'automation_rules',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    /** FK to agents.agent_definitions enforced post-push. */
    agentId: text('agent_id').notNull(),
    /** Stable identifier within an agent for natural-key lookup (e.g. 'daily-brief'). */
    slug: text('slug').notNull(),
    /** Standard 5-field cron string. Validated at insert time. */
    cron: text('cron').notNull(),
    /** When omitted, defaults to UTC. */
    timezone: text('timezone').notNull().default('UTC'),
    enabled: boolean('enabled').notNull().default(true),
    /** Optional configuration payload — agent-specific knobs. */
    config: jsonb('config').$type<AutomationRuleConfig>(),
    /** Last successful tick boundary, in UTC, ISO. Used for idempotency keying. */
    lastTickAt: timestamp('last_tick_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uq_automation_rules_slug').on(t.organizationId, t.agentId, t.slug),
    index('idx_automation_rules_enabled').on(t.enabled, t.organizationId),
    check('automation_rules_cron_check', sql`length(cron) <= 64`),
  ],
)

// ─── Shared types & helpers ───────────────────────────────────────────────────

/** Optional payload merged into every heartbeat trigger. Re-exported as AutomationRuleConfig. */
export interface AutomationRuleConfig {
  /** Optional payload merged into every heartbeat trigger. */
  notes?: string
}

/**
 * Idempotency-key helper — `(scheduleId, intendedRunAt)` uniquely identifies
 * a single cron tick. Workers de-dupe on this key so two simultaneous tick
 * processors don't double-fire a wake.
 *
 * Mirrors `tickIdempotencyKey` from `modules/schedules/schema.ts`.
 */
export function tickIdempotencyKey(scheduleId: string, intendedRunAt: Date): string {
  return `${scheduleId}@${intendedRunAt.toISOString()}`
}
