/**
 * Smoke: CostService upsert + daily spend rollup via PGlite.
 *
 * Exercises the ON CONFLICT DO UPDATE arithmetic in `harness/cost.ts` to catch
 * regressions in the sql`x + y` increment expressions — these cannot be
 * validated with pure unit tests.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'

import { createCostService } from '../../src/harness/cost'
import { tenantCostDaily } from '../../src/schemas/harness'
import type { VobaseDb } from '../../src/db/client'
import { createTenantCostDailyTable, freshDb } from '../helpers/pglite'

let db: VobaseDb

beforeAll(async () => {
  const { db: d } = await freshDb()
  db = d
  await createTenantCostDailyTable(db)
})

beforeEach(async () => {
  await db.delete(tenantCostDaily)
})

describe('CostService (smoke)', () => {
  it('first recordCostUsage INSERTs a new row', async () => {
    const svc = createCostService({ db })
    await svc.recordCostUsage({
      organizationId: 'org_1',
      date: '2026-04-24',
      llmTask: 'classifier',
      tokensIn: 100,
      tokensOut: 50,
      cacheReadTokens: 10,
      costUsd: 0.0042,
    })

    const rows = await db
      .select()
      .from(tenantCostDaily)
      .where(and(eq(tenantCostDaily.organizationId, 'org_1'), eq(tenantCostDaily.date, '2026-04-24')))

    expect(rows).toHaveLength(1)
    expect(rows[0].tokensIn).toBe(100)
    expect(rows[0].tokensOut).toBe(50)
    expect(rows[0].cacheReadTokens).toBe(10)
    expect(Number(rows[0].costUsd)).toBeCloseTo(0.0042, 4)
    expect(rows[0].callCount).toBe(1)
  })

  it('repeated calls accumulate via ON CONFLICT DO UPDATE arithmetic', async () => {
    const svc = createCostService({ db })
    const base = {
      organizationId: 'org_1',
      date: '2026-04-24',
      llmTask: 'classifier',
      tokensIn: 100,
      tokensOut: 50,
      cacheReadTokens: 10,
      costUsd: 0.0042,
    }
    await svc.recordCostUsage(base)
    await svc.recordCostUsage(base)
    await svc.recordCostUsage(base)

    const rows = await db
      .select()
      .from(tenantCostDaily)
      .where(and(eq(tenantCostDaily.organizationId, 'org_1'), eq(tenantCostDaily.date, '2026-04-24')))

    expect(rows).toHaveLength(1)
    expect(rows[0].tokensIn).toBe(300)
    expect(rows[0].tokensOut).toBe(150)
    expect(rows[0].cacheReadTokens).toBe(30)
    expect(Number(rows[0].costUsd)).toBeCloseTo(0.0126, 4)
    expect(rows[0].callCount).toBe(3)
  })

  it('different (org, date, task) tuples do not collide', async () => {
    const svc = createCostService({ db })
    await svc.recordCostUsage({
      organizationId: 'org_1',
      date: '2026-04-24',
      llmTask: 'classifier',
      tokensIn: 10,
      tokensOut: 5,
      cacheReadTokens: 0,
      costUsd: 0.001,
    })
    await svc.recordCostUsage({
      organizationId: 'org_1',
      date: '2026-04-24',
      llmTask: 'summarizer',
      tokensIn: 20,
      tokensOut: 10,
      cacheReadTokens: 0,
      costUsd: 0.002,
    })
    await svc.recordCostUsage({
      organizationId: 'org_2',
      date: '2026-04-24',
      llmTask: 'classifier',
      tokensIn: 30,
      tokensOut: 15,
      cacheReadTokens: 0,
      costUsd: 0.003,
    })

    const rows = await db.select().from(tenantCostDaily)
    expect(rows).toHaveLength(3)
  })

  it('getDailySpend sums costUsd across tasks for today', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const svc = createCostService({ db })
    await svc.recordCostUsage({
      organizationId: 'org_1',
      date: today,
      llmTask: 'classifier',
      tokensIn: 0,
      tokensOut: 0,
      cacheReadTokens: 0,
      costUsd: 1.23,
    })
    await svc.recordCostUsage({
      organizationId: 'org_1',
      date: today,
      llmTask: 'summarizer',
      tokensIn: 0,
      tokensOut: 0,
      cacheReadTokens: 0,
      costUsd: 4.56,
    })

    expect(await svc.getDailySpend('org_1')).toBeCloseTo(5.79, 2)
  })

  it('getDailySpend returns 0 when no rows match today', async () => {
    const svc = createCostService({ db })
    await svc.recordCostUsage({
      organizationId: 'org_1',
      date: '2020-01-01',
      llmTask: 'classifier',
      tokensIn: 0,
      tokensOut: 0,
      cacheReadTokens: 0,
      costUsd: 99.99,
    })
    expect(await svc.getDailySpend('org_1')).toBe(0)
  })
})
