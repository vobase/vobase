/**
 * `automation_runs` retention sweeper (US-015 / Slice D.3).
 *
 * Pure function — takes `now` as a parameter so tests can pin the clock. The
 * sole writer is this module (`check:shape` rule already covers
 * `automation_runs` via the dispatcher; this DELETE is its retention twin).
 *
 * Seeded as `automation-runs-prune` cron (0 3 * * * UTC) in `seed.ts`. The
 * actual deletion fires from the pg-boss handler in `jobs.ts` — the seeded
 * automation rule is documentation + dashboard visibility; the cron-tick that
 * actually drives the prune is registered as a recurring pg-boss schedule
 * keyed on `AUTOMATIONS_RUNS_PRUNE_JOB`.
 */

import { automationRuns } from '@modules/automations/schema'
import { lt, sql } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

/** Retention window — rows older than this are reaped. */
export const RUNS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/**
 * Delete every `automation_runs` row whose `started_at` is older than
 * `now - 30 days`. Returns the number of rows removed.
 *
 * Pure: clock is injected so the test pins it deterministically.
 */
export async function pruneAutomationRuns(now: Date, db: ScopedDb): Promise<number> {
  const cutoff = new Date(now.getTime() - RUNS_RETENTION_MS)
  // drizzle-orm `.returning()` on DELETE lets us count rows without a
  // separate COUNT(*) query — and stays portable across pg drivers.
  const deleted = await db
    .delete(automationRuns)
    .where(lt(automationRuns.startedAt, cutoff))
    .returning({ id: automationRuns.id })
  return deleted.length
}

/**
 * Cron expression for the nightly prune — UTC 03:00.
 *
 * Exported so `seed.ts` and `jobs.ts` share the literal — the seeded
 * automations row and the pg-boss recurring schedule must align.
 */
export const AUTOMATION_RUNS_PRUNE_CRON = '0 3 * * *'

/** Rule name used when seeding the dashboard-visible automations row. */
export const AUTOMATION_RUNS_PRUNE_RULE_NAME = 'automation-runs-prune'

/** Placeholder system-agent id for the seeded prune automation row. */
export const SYSTEM_PRUNE_AGENT_ID = 'agent:automation-runs-prune-system'

/**
 * Convenience for callers that want the raw DELETE SQL (e.g. one-off ops
 * scripts) — exported so callers don't have to rebuild the cutoff math.
 */
export function pruneAutomationRunsSql(now: Date) {
  const cutoff = new Date(now.getTime() - RUNS_RETENTION_MS)
  return sql`DELETE FROM automations.automation_runs WHERE started_at < ${cutoff.toISOString()}::timestamptz`
}
