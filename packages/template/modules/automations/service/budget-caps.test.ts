/**
 * Integration test for `budget-caps.setBudget` upsert + delete-on-null + audit.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createBudgetCapsService } from '@modules/automations/service/budget-caps'
import { sql } from 'drizzle-orm'

import type { TestDbHandle } from '../../../tests/helpers/test-db'
import { connectTestDb, resetAndSeedDb } from '../../../tests/helpers/test-db'

describe('budget-caps.setBudget', () => {
  let handle: TestDbHandle

  beforeAll(async () => {
    await resetAndSeedDb()
    handle = connectTestDb()
  }, 60_000)

  afterAll(async () => {
    if (handle) await handle.teardown()
  })

  it('upserts a cap row and writes audit_log entry', async () => {
    const { db, client } = handle
    const svc = createBudgetCapsService({
      db: db as unknown as Parameters<typeof createBudgetCapsService>[0]['db'],
    })
    const orgId = `org-budget-${Date.now()}`

    const auditBefore =
      await client`SELECT COUNT(*)::int AS n FROM audit.audit_log WHERE event = 'automations.budget_set' AND actor_id = 'user:test-budget'`

    await svc.setBudget(orgId, 500, { actor: { id: 'user:test-budget', kind: 'user' } })

    const after =
      await client`SELECT daily_cap_usd FROM automations.tenant_budget_caps WHERE organization_id = ${orgId}`
    expect(after[0]?.daily_cap_usd).toBe(500)

    const auditAfter =
      await client`SELECT COUNT(*)::int AS n FROM audit.audit_log WHERE event = 'automations.budget_set' AND actor_id = 'user:test-budget'`
    expect(auditAfter[0].n).toBe(auditBefore[0].n + 1)

    // Cleanup
    await db.execute(sql`DELETE FROM automations.tenant_budget_caps WHERE organization_id = ${orgId}`)
  })

  it('deletes the row when capUsd is null', async () => {
    const { db, client } = handle
    const svc = createBudgetCapsService({
      db: db as unknown as Parameters<typeof createBudgetCapsService>[0]['db'],
    })
    const orgId = `org-budget-del-${Date.now()}`

    await svc.setBudget(orgId, 1000, { actor: { id: 'user:test-budget', kind: 'user' } })
    const before =
      await client`SELECT COUNT(*)::int AS n FROM automations.tenant_budget_caps WHERE organization_id = ${orgId}`
    expect(before[0].n).toBe(1)

    await svc.setBudget(orgId, null, { actor: { id: 'user:test-budget', kind: 'user' } })

    const after =
      await client`SELECT COUNT(*)::int AS n FROM automations.tenant_budget_caps WHERE organization_id = ${orgId}`
    expect(after[0].n).toBe(0)
  })

  it('getBudget returns null when no row exists', async () => {
    const { db } = handle
    const svc = createBudgetCapsService({
      db: db as unknown as Parameters<typeof createBudgetCapsService>[0]['db'],
    })
    expect(await svc.getBudget('org-nonexistent-budget')).toBeNull()
  })
})
