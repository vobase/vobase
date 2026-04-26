/**
 * `schedules` module schema.
 *
 * Owns the `agent_schedules` table — a cron-driven heartbeat for an agent.
 * Each row produces one wake per cron tick with `trigger.kind = 'heartbeat'`.
 *
 * Cross-schema FK to `agents.agent_definitions(id)` is enforced post-push
 * (drizzle-kit push doesn't span pgSchemas in a single graph).
 */

import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import { boolean, check, index, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { schedulesPgSchema } from '~/runtime'

export interface AgentScheduleConfig {
  /** Optional payload merged into every heartbeat trigger. */
  notes?: string
}

export const agentSchedules = schedulesPgSchema.table(
  'agent_schedules',
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
    config: jsonb('config').$type<AgentScheduleConfig>(),
    /** Last successful tick boundary, in UTC, ISO. Used for idempotency keying. */
    lastTickAt: timestamp('last_tick_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uq_agent_schedules_slug').on(t.organizationId, t.agentId, t.slug),
    index('idx_agent_schedules_enabled').on(t.enabled, t.organizationId),
    check('agent_schedules_cron_check', sql`length(cron) <= 64`),
  ],
)

/**
 * Idempotency-key helper — `(scheduleId, intendedRunAt)` uniquely identifies
 * a single cron tick. Workers de-dupe on this key so two simultaneous tick
 * processors don't double-fire a wake.
 */
export function tickIdempotencyKey(scheduleId: string, intendedRunAt: Date): string {
  return `${scheduleId}@${intendedRunAt.toISOString()}`
}
