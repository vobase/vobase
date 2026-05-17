/**
 * GET /api/automations/health — automations subsystem health probe
 * (US-015 / Slice D.3).
 *
 * Returns three numeric staleness indicators usable for external monitoring:
 *
 *   - `lastDispatchAgeSec`     — seconds since the most recent
 *                                automation_runs row (any rule). `null` if no
 *                                dispatch has happened in the last hour.
 *   - `queueDepth`             — count of `automation_runs.status='queued'`
 *                                rows (rough back-pressure indicator).
 *   - `watcherLastTickAgeSec`  — seconds since the most recent
 *                                `budget-watcher` automation rule's run row.
 *                                `null` if the watcher has never fired (or
 *                                its run rows have been pruned).
 *
 * Auth: routes mounted by the automations module are NOT session-gated (the
 * module currently has no `web` slot wired). For Slice D.3 we co-locate the
 * health probe inside the system module's `/api/system/health/automations`
 * to match the precedent (`/api/system/health` is session-gated like the
 * other `/api/system/*` endpoints). Operators monitoring externally can
 * still hit it via a bearer-token bearing the org admin's session — matches
 * the existing /system endpoints (`/audit-log`, `/sequences`, `/activity/*`).
 */

import { automationRuns, automations } from '@modules/automations/schema'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { requireDb } from '../../system/service'

const ONE_HOUR_MS = 60 * 60 * 1000
const BUDGET_WATCHER_RULE_NAME = 'budget-watcher'

const app = new Hono().get('/health/automations', async (c) => {
  const db = requireDb()
  const now = Date.now()
  const sinceHour = new Date(now - ONE_HOUR_MS)

  // Most-recent dispatch in the last hour. We bound the window so the query
  // hits the (started_at) index and remains O(active runs in the hour).
  const lastDispatchRows = (await db
    .select({ startedAt: automationRuns.startedAt })
    .from(automationRuns)
    .where(gte(automationRuns.startedAt, sinceHour))
    .orderBy(desc(automationRuns.startedAt))
    .limit(1)) as Array<{ startedAt: Date }>
  const lastDispatchAgeSec = lastDispatchRows[0]
    ? Math.floor((now - lastDispatchRows[0].startedAt.getTime()) / 1000)
    : null

  // Queue depth — count of pending (queued) runs across all orgs.
  const queueRows = (await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(automationRuns)
    .where(eq(automationRuns.status, 'queued'))) as Array<{ n: number }>
  const queueDepth = queueRows[0]?.n ?? 0

  // Watcher tick — most-recent run row joined to the `budget-watcher` rule.
  // The watcher fires once per minute per tenant; staleness > a few minutes
  // means the cron tick is wedged.
  const watcherRows = (await db
    .select({ startedAt: automationRuns.startedAt })
    .from(automationRuns)
    .innerJoin(automations, eq(automations.id, automationRuns.ruleId))
    .where(and(eq(automations.name, BUDGET_WATCHER_RULE_NAME)))
    .orderBy(desc(automationRuns.startedAt))
    .limit(1)) as Array<{ startedAt: Date }>
  const watcherLastTickAgeSec = watcherRows[0] ? Math.floor((now - watcherRows[0].startedAt.getTime()) / 1000) : null

  return c.json({
    lastDispatchAgeSec,
    queueDepth,
    watcherLastTickAgeSec,
  })
})

export default app
