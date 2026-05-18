/**
 * Sole writer of `automations.tenant_budget_caps`.
 *
 * `setBudget(orgId, capUsd, { actor })` is the single mutation surface. Passing
 * `capUsd === null` deletes the row (per-tenant cap removed → no budget gate).
 * The UPSERT/DELETE and the `audit.audit_log` row both land inside the same
 * Postgres tx so rollback ⇒ no audit leak.
 *
 * `getBudget` is a read helper used by the budget-watcher tick.
 *
 * Default policy: OFF. New tenants have no row → `getBudget` returns null →
 * dispatcher / watcher treat the org as uncapped. Operators opt in via the
 * settings UI (or CLI) which calls `setBudget`.
 */

import { tenantBudgetCaps } from '@modules/automations/schema'
import type { Actor } from '@modules/automations/service/automations'
import { auditLog } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { type RealtimeService, type ScopedDb, safeNotify, type Tx } from '~/runtime'

export interface BudgetCapsService {
  /** Read the current cap for `orgId`. Returns null when no row exists (= no cap). */
  getBudget(orgId: string): Promise<{ dailyCapUsd: number; updatedAt: Date } | null>
  /**
   * Set or remove the per-tenant daily cap. `capUsd === null` deletes the row.
   * `capUsd` is in cents (matches `tenantBudgetCaps.dailyCapUsd` column).
   */
  setBudget(orgId: string, capUsd: number | null, opts: { actor: Actor }): Promise<void>
}

export interface BudgetCapsServiceDeps {
  db: ScopedDb
  /**
   * Optional realtime handle — when provided, `setBudget` emits a `pg_notify`
   * after commit so the `/automations` banner refetches the cap without
   * a manual reload.
   */
  realtime?: RealtimeService
}

export function createBudgetCapsService(deps: BudgetCapsServiceDeps): BudgetCapsService {
  const db = deps.db
  const realtime = deps.realtime
  const txDb = db as unknown as { transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> }

  return {
    async getBudget(orgId) {
      const rows = await db
        .select({
          dailyCapUsd: tenantBudgetCaps.dailyCapUsd,
          updatedAt: tenantBudgetCaps.updatedAt,
        })
        .from(tenantBudgetCaps)
        .where(eq(tenantBudgetCaps.organizationId, orgId))
        .limit(1)
      return rows[0] ?? null
    },

    async setBudget(orgId, capUsd, opts) {
      await txDb.transaction(async (tx) => {
        const t = tx as unknown as typeof db
        if (capUsd === null) {
          await t.delete(tenantBudgetCaps).where(eq(tenantBudgetCaps.organizationId, orgId))
        } else {
          await t
            .insert(tenantBudgetCaps)
            .values({ organizationId: orgId, dailyCapUsd: capUsd })
            .onConflictDoUpdate({
              target: [tenantBudgetCaps.organizationId],
              set: { dailyCapUsd: capUsd },
            })
        }
        await t.insert(auditLog).values({
          event: 'automations.budget_set',
          actorId: opts.actor.id,
          details: JSON.stringify({
            actorKind: opts.actor.kind,
            targetId: orgId,
            organizationId: orgId,
            dailyCapUsd: capUsd,
          }),
        })
      })
      if (realtime) {
        safeNotify(realtime, { table: 'tenant_budget_caps', id: orgId, action: capUsd === null ? 'cleared' : 'set' })
      }
    },
  }
}

// ─── Singleton install pattern (mirrors automations.ts) ──────────────────────

let _current: BudgetCapsService | null = null

export function installBudgetCapsService(svc: BudgetCapsService): void {
  _current = svc
}

export function __resetBudgetCapsServiceForTests(): void {
  _current = null
}

function current(): BudgetCapsService {
  if (!_current) throw new Error('budget-caps: service not installed')
  return _current
}

export const budgetCapsService = {
  getBudget: (orgId: string) => current().getBudget(orgId),
  setBudget: (orgId: string, capUsd: number | null, opts: { actor: Actor }) => current().setBudget(orgId, capUsd, opts),
}
