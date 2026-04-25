/**
 * Sole write path for `harness.tenant_cost_daily`.
 *
 * `recordCostUsage` is the ONLY function that may INSERT or UPDATE this table.
 * Observers (e.g. cost-aggregator) call this; they never import drizzle directly.
 */

import { and, eq, sql } from 'drizzle-orm'

import { tenantCostDaily } from '../schemas/harness'

export type Tx = unknown

type InsertChain = {
  values: (vals: unknown) => {
    onConflictDoUpdate: (cfg: { target: unknown; set: unknown }) => Promise<unknown>
  }
}
type SelectChain = {
  from: (table: unknown) => {
    where: (cond: unknown) => Promise<Array<{ costUsd: string | null }>>
  }
}
type DbHandle = {
  insert: (table: unknown) => InsertChain
  select: (fields: unknown) => SelectChain
}

export interface RecordCostInput {
  organizationId: string
  /** 'YYYY-MM-DD' */
  date: string
  llmTask: string
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  costUsd: number
}

export interface CostService {
  recordCostUsage(input: RecordCostInput, tx?: Tx): Promise<void>
  getDailySpend(organizationId: string): Promise<number>
}

export interface CostServiceDeps {
  db: unknown
}

export function createCostService(deps: CostServiceDeps): CostService {
  const db = deps.db as DbHandle

  async function recordCostUsage(input: RecordCostInput, tx?: Tx): Promise<void> {
    const runner = (tx as DbHandle | undefined) ?? db

    await runner
      .insert(tenantCostDaily)
      .values({
        organizationId: input.organizationId,
        date: input.date,
        llmTask: input.llmTask,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        cacheReadTokens: input.cacheReadTokens,
        costUsd: String(input.costUsd),
        callCount: 1,
      })
      .onConflictDoUpdate({
        target: [tenantCostDaily.organizationId, tenantCostDaily.date, tenantCostDaily.llmTask],
        set: {
          tokensIn: sql`${tenantCostDaily.tokensIn} + ${input.tokensIn}`,
          tokensOut: sql`${tenantCostDaily.tokensOut} + ${input.tokensOut}`,
          cacheReadTokens: sql`${tenantCostDaily.cacheReadTokens} + ${input.cacheReadTokens}`,
          costUsd: sql`${tenantCostDaily.costUsd} + ${String(input.costUsd)}::numeric`,
          callCount: sql`${tenantCostDaily.callCount} + 1`,
        },
      })
  }

  async function getDailySpend(organizationId: string): Promise<number> {
    const today = new Date().toISOString().slice(0, 10)

    const rows = await db
      .select({ costUsd: tenantCostDaily.costUsd })
      .from(tenantCostDaily)
      .where(and(eq(tenantCostDaily.organizationId, organizationId), eq(tenantCostDaily.date, today)))

    return rows.reduce((sum, r) => sum + Number(r.costUsd ?? 0), 0)
  }

  return { recordCostUsage, getDailySpend }
}

let _currentCostService: CostService | null = null

export function installCostService(svc: CostService): void {
  _currentCostService = svc
}

export function __resetCostServiceForTests(): void {
  _currentCostService = null
}

function current(): CostService {
  if (!_currentCostService) {
    throw new Error('harness/cost: service not installed — call installCostService() during boot')
  }
  return _currentCostService
}

export function setCostDb(db: unknown): void {
  installCostService(createCostService({ db }))
}

export function recordCostUsage(input: RecordCostInput, tx?: Tx): Promise<void> {
  return current().recordCostUsage(input, tx)
}

export function getDailySpend(organizationId: string): Promise<number> {
  return current().getDailySpend(organizationId)
}
