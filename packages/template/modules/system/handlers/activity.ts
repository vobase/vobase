/**
 * /api/system/activity — read-only endpoints powering the `/system/activity`
 * dashboard.
 *
 * Four endpoints, one per dashboard widget:
 *
 *   GET /activity/banner       → ActivityBanner stats (today cost, active wakes,
 *                                paused rules, budget cap, % used)
 *   GET /activity/automations  → AutomationsTable rows (rules + 24h aggregates)
 *   GET /activity/runs         → RecentRunsTable rows (24h automation_runs +
 *                                joined cost from harness.conversation_events)
 *   GET /activity/active-wakes → ActiveWakesPanel rows (harness.active_wakes)
 *
 * All four are reads only — no `db.update`/`db.insert`. Mutations land via
 * the system module's verbs (automations:pause / automations:resume /
 * budget-set), which route through the automations + budget-caps services so
 * the one-write-path invariants stay intact.
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { automationRuns, automations, tenantBudgetCaps } from '@modules/automations/schema'
import { activeWakes, conversationEvents, tenantCostDaily } from '@vobase/core'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { requireDb } from '../service'

// 24h window for run / aggregate queries.
function since24h(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000)
}

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .get('/activity/banner', async (c) => {
    const db = requireDb()
    const orgId = c.get('organizationId')

    // today_cost: SUM(cost_usd) from tenant_cost_daily for today (UTC date)
    const todayStr = new Date().toISOString().slice(0, 10) // 'YYYY-MM-DD'
    const costRows = (await db
      .select({ total: sql<string>`COALESCE(SUM(${tenantCostDaily.costUsd}), 0)` })
      .from(tenantCostDaily)
      .where(and(eq(tenantCostDaily.organizationId, orgId), eq(tenantCostDaily.date, todayStr)))) as Array<{
      total: string | number
    }>
    const todayCostUsd = Number(costRows[0]?.total ?? 0)

    // active_wakes count
    const activeRows = (await db.select({ n: sql<number>`COUNT(*)::int` }).from(activeWakes)) as Array<{ n: number }>
    const activeWakesCount = activeRows[0]?.n ?? 0

    // paused rules
    const pausedRows = (await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(automations)
      .where(and(eq(automations.organizationId, orgId), eq(automations.paused, true)))) as Array<{ n: number }>
    const pausedRules = pausedRows[0]?.n ?? 0

    // budget cap
    const capRows = await db
      .select({ dailyCapUsd: tenantBudgetCaps.dailyCapUsd })
      .from(tenantBudgetCaps)
      .where(eq(tenantBudgetCaps.organizationId, orgId))
      .limit(1)
    const budgetCapUsd = capRows[0] ? capRows[0].dailyCapUsd / 100 : null
    const percentUsed = budgetCapUsd && budgetCapUsd > 0 ? (todayCostUsd / budgetCapUsd) * 100 : null

    return c.json({
      todayCostUsd,
      activeWakes: activeWakesCount,
      pausedRules,
      budgetCapUsd,
      percentUsed,
    })
  })
  .get('/activity/automations', async (c) => {
    const db = requireDb()
    const orgId = c.get('organizationId')
    const since = since24h()

    // Rules in this org.
    const rules = (await db
      .select({
        id: automations.id,
        name: automations.name,
        eventName: automations.eventName,
        action: automations.action,
        paused: automations.paused,
        pausedReason: automations.pausedReason,
        pausedAt: automations.pausedAt,
        cron: automations.cron,
        createdAt: automations.createdAt,
        updatedAt: automations.updatedAt,
      })
      .from(automations)
      .where(eq(automations.organizationId, orgId))
      .orderBy(automations.name)) as Array<{
      id: string
      name: string
      eventName: string
      action: { type: 'wake' | 'webhook'; agentId?: string; lane?: 'conversation' | 'standalone' }
      paused: boolean
      pausedReason: string | null
      pausedAt: Date | null
      cron: string | null
      createdAt: Date
      updatedAt: Date
    }>

    // 24h aggregate per rule: total fire count, suppression count, last fire ts,
    // last status. One scan over automation_runs grouped by ruleId.
    const aggRows = (await db
      .select({
        ruleId: automationRuns.ruleId,
        fireCount: sql<number>`COUNT(*)::int`,
        suppressionCount: sql<number>`SUM(CASE WHEN ${automationRuns.status} LIKE 'suppressed%' THEN 1 ELSE 0 END)::int`,
        lastFire: sql<Date | null>`MAX(${automationRuns.startedAt})`,
      })
      .from(automationRuns)
      .where(and(eq(automationRuns.organizationId, orgId), gte(automationRuns.startedAt, since)))
      .groupBy(automationRuns.ruleId)) as Array<{
      ruleId: string
      fireCount: number
      suppressionCount: number
      lastFire: Date | null
    }>

    // Last status per rule — separate query keyed on most-recent startedAt.
    // (Cheaper than a window function over a small 24h slice.)
    const lastStatusRows = (await db
      .select({ ruleId: automationRuns.ruleId, status: automationRuns.status, startedAt: automationRuns.startedAt })
      .from(automationRuns)
      .where(and(eq(automationRuns.organizationId, orgId), gte(automationRuns.startedAt, since)))
      .orderBy(desc(automationRuns.startedAt))) as Array<{ ruleId: string; status: string; startedAt: Date }>
    const lastStatusByRule = new Map<string, string>()
    for (const r of lastStatusRows) {
      if (!lastStatusByRule.has(r.ruleId)) lastStatusByRule.set(r.ruleId, r.status)
    }

    const aggByRule = new Map(aggRows.map((r) => [r.ruleId, r]))

    return c.json({
      rules: rules.map((r) => {
        const agg = aggByRule.get(r.id)
        return {
          id: r.id,
          name: r.name,
          eventName: r.eventName,
          actionType: r.action.type,
          actionAgentId: r.action.agentId ?? null,
          lane: r.action.lane ?? null,
          paused: r.paused,
          pausedReason: r.pausedReason,
          pausedAt: r.pausedAt,
          cron: r.cron,
          fireCount24h: agg?.fireCount ?? 0,
          suppressionCount24h: agg?.suppressionCount ?? 0,
          lastFire: agg?.lastFire ?? null,
          lastStatus: lastStatusByRule.get(r.id) ?? null,
        }
      }),
    })
  })
  .get('/activity/runs', async (c) => {
    const db = requireDb()
    const orgId = c.get('organizationId')
    const since = since24h()

    // Cost per wake from harness.conversation_events.
    const costByWake = (await db
      .select({
        wakeId: conversationEvents.wakeId,
        costUsd: sql<string>`COALESCE(SUM(${conversationEvents.costUsd}), 0)`,
      })
      .from(conversationEvents)
      .where(
        and(
          eq(conversationEvents.organizationId, orgId),
          gte(conversationEvents.ts, since),
          sql`${conversationEvents.wakeId} IS NOT NULL`,
        ),
      )
      .groupBy(conversationEvents.wakeId)) as Array<{ wakeId: string | null; costUsd: string }>
    const costMap = new Map<string, number>()
    for (const r of costByWake) {
      if (r.wakeId) costMap.set(r.wakeId, Number(r.costUsd))
    }

    // Runs in window — join the rule name for display.
    const runs = (await db
      .select({
        id: automationRuns.id,
        ruleId: automationRuns.ruleId,
        ruleName: automations.name,
        eventName: automationRuns.eventName,
        status: automationRuns.status,
        startedAt: automationRuns.startedAt,
        finishedAt: automationRuns.finishedAt,
        durationMs: automationRuns.durationMs,
        wakeId: automationRuns.wakeId,
        errorMessage: automationRuns.errorMessage,
      })
      .from(automationRuns)
      .leftJoin(automations, eq(automations.id, automationRuns.ruleId))
      .where(and(eq(automationRuns.organizationId, orgId), gte(automationRuns.startedAt, since)))
      .orderBy(desc(automationRuns.startedAt))
      .limit(200)) as Array<{
      id: string
      ruleId: string
      ruleName: string | null
      eventName: string
      status: string
      startedAt: Date
      finishedAt: Date | null
      durationMs: number | null
      wakeId: string | null
      errorMessage: string | null
    }>

    return c.json({
      runs: runs.map((r) => ({
        id: r.id,
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        eventName: r.eventName,
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        durationMs: r.durationMs,
        wakeId: r.wakeId,
        costUsd: r.wakeId ? (costMap.get(r.wakeId) ?? 0) : 0,
        errorMessage: r.errorMessage,
      })),
    })
  })
  .get('/activity/active-wakes', async (c) => {
    const db = requireDb()
    // active_wakes is UNLOGGED + global (one row per conversationId) — we cannot
    // filter by organizationId at the row level. The widget surface is staff +
    // a single tenant per deployment in template usage, so this is acceptable.
    const rows = (await db
      .select({
        conversationId: activeWakes.conversationId,
        workerId: activeWakes.workerId,
        startedAt: activeWakes.startedAt,
        debounceUntil: activeWakes.debounceUntil,
      })
      .from(activeWakes)
      .orderBy(desc(activeWakes.startedAt))
      .limit(50)) as Array<{
      conversationId: string
      workerId: string
      startedAt: Date
      debounceUntil: Date
    }>

    return c.json({
      wakes: rows.map((r) => ({
        conversationId: r.conversationId,
        workerId: r.workerId,
        startedAt: r.startedAt,
        debounceUntil: r.debounceUntil,
      })),
    })
  })

export default app
