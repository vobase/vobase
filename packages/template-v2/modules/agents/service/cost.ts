/**
 * Sole write path for `agents.tenant_cost_daily`.
 *
 * `recordCostUsage` is the ONLY function that may INSERT or UPDATE this table.
 * Observers (e.g. cost-aggregator) call this; they never import drizzle directly.
 */
import type { Tx } from '@server/contracts/inbox-port'

type InsertChain = {
  values: (vals: unknown) => {
    onConflictDoUpdate: (cfg: { target: unknown; set: unknown }) => Promise<unknown>
  }
}
type SelectChain = {
  from: (table: unknown) => { where: (cond: unknown) => Promise<Array<{ costUsd: string | null }>> }
}
type DbHandle = {
  insert: (table: unknown) => InsertChain
  select: (fields: unknown) => SelectChain
}

let _db: DbHandle | null = null

export function setCostDb(db: unknown): void {
  _db = db as DbHandle
}

function requireDb(): DbHandle {
  if (!_db) throw new Error('agents/cost: db not initialised — call setCostDb() in module init')
  return _db
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

export async function recordCostUsage(input: RecordCostInput, tx?: Tx): Promise<void> {
  const { tenantCostDaily } = await import('@modules/agents/schema')
  const { sql } = await import('drizzle-orm')
  const runner = (tx as DbHandle | undefined) ?? requireDb()

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

/** Returns today's total spend (USD) across all llmTasks for this organization. */
export async function getDailySpend(organizationId: string): Promise<number> {
  const { tenantCostDaily } = await import('@modules/agents/schema')
  const { eq, and } = await import('drizzle-orm')

  const today = new Date().toISOString().slice(0, 10)

  const rows = await requireDb()
    .select({ costUsd: tenantCostDaily.costUsd })
    .from(tenantCostDaily)
    .where(and(eq(tenantCostDaily.organizationId, organizationId), eq(tenantCostDaily.date, today)))

  return rows.reduce((sum, r) => sum + Number(r.costUsd ?? 0), 0)
}
