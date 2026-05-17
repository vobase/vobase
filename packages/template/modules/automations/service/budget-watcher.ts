/**
 * Daily-budget watcher (US-013 / Slice D.1).
 *
 * `runBudgetWatcherTick()` walks every tenant with a non-null cap row in
 * `tenant_budget_caps`, SUMs `harness.conversation_events.cost_usd` for the
 * current UTC day, and pauses every active rule when the org has crossed its
 * cap. Each pause writes an `audit.audit_log` row (`automations.paused`,
 * `actorKind='system'`, `actorId='system:budget-watcher'`) inside the
 * `pauseRule` tx — so an aborted pause never leaves an audit leak.
 *
 * Production performance note: `harness.conversation_events (organization_id,
 * ts)` index is recommended for SUM queries at scale. The schema in
 * `packages/core/src/schemas/harness.ts` already includes `idx_convev_conv`
 * (`conversation_id, ts`); a future `idx_conv_events_org_ts` can be added via
 * `CREATE INDEX CONCURRENTLY` against tenant DBs without touching the Drizzle
 * schema. See plan §5.2.
 *
 * Seeded as a `* * * * *` cron rule in `seed.ts`; the dispatcher routes the
 * tick to a system agent that exec-bashes `runBudgetWatcherTick()` (or, more
 * pragmatically today, the heartbeat handler is special-cased to recognise the
 * `budget-watcher` rule name and call this function directly).
 */

import { tenantBudgetCaps } from '@modules/automations/schema'
import { dispatchAdminAlert } from '@modules/automations/service/admin-alert'
import { type Actor, automationsService, SYSTEM_BUDGET_WATCHER_ACTOR } from '@modules/automations/service/automations'
import { logger } from '@vobase/core'
import { sql } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

export interface BudgetWatcherTickRow {
  orgId: string
  budgetCapUsd: number
  spentUsd: number
  breached: boolean
  pausedRuleIds: string[]
}

export interface RunBudgetWatcherOpts {
  /** Override clock — tests pin to a deterministic now. */
  now?: Date
  /** Override actor (defaults to SYSTEM_BUDGET_WATCHER_ACTOR). */
  actor?: Actor
  /** Override DB handle (defaults to the singleton installed by module init). */
  db?: ScopedDb
}

let _installedDb: ScopedDb | null = null
export function installBudgetWatcherDb(db: ScopedDb): void {
  _installedDb = db
}
export function __resetBudgetWatcherDbForTests(): void {
  _installedDb = null
}

/**
 * Drive one round of the budget watcher.
 *
 * For each tenant with a row in `tenant_budget_caps`:
 *   1. SUM `harness.conversation_events.cost_usd` for the current UTC day.
 *   2. Compare spent (USD float) to capUsd (cents → dollars).
 *   3. If spent > cap, list every non-paused automation rule for the org and
 *      pause each via `pauseRule(reason='budget_exceeded')`.
 *
 * Returns one summary row per tenant inspected.
 */
export async function runBudgetWatcherTick(opts: RunBudgetWatcherOpts = {}): Promise<BudgetWatcherTickRow[]> {
  const db = opts.db ?? _installedDb
  if (!db) throw new Error('budget-watcher: db not installed (call installBudgetWatcherDb at boot)')

  const now = opts.now ?? new Date()
  const actor = opts.actor ?? SYSTEM_BUDGET_WATCHER_ACTOR

  // UTC day boundary: 00:00:00.000Z of `now`.
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))

  // Pull every tenant cap row.
  const caps = await db
    .select({
      orgId: tenantBudgetCaps.organizationId,
      dailyCapUsd: tenantBudgetCaps.dailyCapUsd,
    })
    .from(tenantBudgetCaps)

  const results: BudgetWatcherTickRow[] = []

  for (const cap of caps) {
    // SUM cost_usd for the org since the start of the UTC day. `cost_usd` is
    // numeric(10,6) on `harness.conversation_events`; the COALESCE handles
    // tenants with zero rows for the day.
    const dayStartIso = dayStart.toISOString()
    const sumRows = await db.execute(sql`
      SELECT COALESCE(SUM(cost_usd), 0)::float AS spent_usd
      FROM harness.conversation_events
      WHERE organization_id = ${cap.orgId}
        AND ts >= ${dayStartIso}::timestamptz
    `)
    // drizzle-orm `execute` returns a RowList (array-like). Coerce defensively.
    const firstRow = (sumRows as unknown as Array<{ spent_usd: number | string }>)[0]
    const spentUsd = firstRow ? Number(firstRow.spent_usd) : 0

    // Cap stored as cents → convert to USD for comparison.
    const capUsd = cap.dailyCapUsd / 100
    const breached = spentUsd > capUsd

    const pausedRuleIds: string[] = []
    if (breached) {
      const liveRules = await automationsService.listRulesForEvent('cron', cap.orgId)
      // listRulesForEvent returns both paused and not-paused; we only act on the
      // non-paused subset. We also pause every event-driven rule (not just
      // cron), so additionally pull rules for the other event names the
      // dispatcher knows about.
      const otherEventNames = [
        'conversation_reassigned',
        'approval_filed',
        'approval_decided',
        'proposal_filed',
        'proposal_decided',
      ]
      const allRules = [...liveRules]
      for (const ev of otherEventNames) {
        const rows = await automationsService.listRulesForEvent(ev, cap.orgId)
        allRules.push(...rows)
      }
      for (const r of allRules) {
        if (r.paused) continue
        await automationsService.pauseRule(r.id, 'budget_exceeded', { actor })
        pausedRuleIds.push(r.id)
      }

      // Post-pause admin alert (US-015 / Slice D.3). Dedup is keyed on the UTC
      // calendar day so a repeated breach the next day re-alerts; multiple
      // checks the same day collapse to one notification.
      const dayString = dayStart.toISOString().slice(0, 10) // YYYY-MM-DD
      try {
        await dispatchAdminAlert(
          {
            orgId: cap.orgId,
            kind: 'budget_breach',
            bodyText: `Daily budget cap of $${capUsd.toFixed(2)} exceeded ($${spentUsd.toFixed(
              2,
            )} spent). All automations paused.`,
            dedupKey: `budget_breach:${cap.orgId}:${dayString}`,
          },
          { now },
        )
      } catch (err) {
        // Admin-alert dispatch is best-effort; never let it abort the watcher
        // loop. The pauses already landed; the operator can still see the run
        // via /system/activity.
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), orgId: cap.orgId },
          '[automations/budget-watcher] dispatchAdminAlert failed (non-fatal)',
        )
      }
    }

    results.push({
      orgId: cap.orgId,
      budgetCapUsd: capUsd,
      spentUsd,
      breached,
      pausedRuleIds,
    })
  }

  return results
}
