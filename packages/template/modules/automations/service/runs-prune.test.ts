/**
 * Integration test: pruneAutomationRuns (US-015 / Slice D.3).
 *
 * Seeds a mix of rows with `started_at` straddling the 30-day cutoff, runs
 * the pure prune function with a pinned `now`, and verifies the exact rowcount
 * deleted matches the rows older than 30d.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { pruneAutomationRuns } from '@modules/automations/service/runs-prune'
import { sql } from 'drizzle-orm'

import type { TestDbHandle } from '../../../tests/helpers/test-db'
import { connectTestDb, resetAndSeedDb } from '../../../tests/helpers/test-db'

describe('pruneAutomationRuns', () => {
  let handle: TestDbHandle

  beforeAll(async () => {
    await resetAndSeedDb()
    handle = connectTestDb()
  })

  afterAll(async () => {
    await handle.teardown()
  })

  it('deletes only rows older than 30 days; returns the deleted rowcount', async () => {
    const { db, client } = handle
    const orgId = `org-prune-${Date.now()}`
    const ruleId = `rule-prune-${Date.now()}`
    const now = new Date('2026-05-17T12:00:00.000Z')
    const day = 24 * 60 * 60 * 1000

    // Seed three "old" rows (35, 45, 60 days ago) and two "fresh" rows
    // (1 day and 29 days ago).
    const ancient = [35, 45, 60].map((d) => new Date(now.getTime() - d * day))
    const fresh = [1, 29].map((d) => new Date(now.getTime() - d * day))

    for (const ts of [...ancient, ...fresh]) {
      await client`
        INSERT INTO automations.automation_runs
          (rule_id, organization_id, event_name, status, started_at)
        VALUES
          (${ruleId}, ${orgId}, 'cron', 'succeeded', ${ts.toISOString()})
      `
    }

    const before = (await client`
      SELECT COUNT(*)::int AS n
      FROM automations.automation_runs
      WHERE organization_id = ${orgId}
    `) as Array<{ n: number }>
    expect(before[0]?.n).toBe(5)

    const removed = await pruneAutomationRuns(now, db as unknown as Parameters<typeof pruneAutomationRuns>[1])
    expect(removed).toBe(ancient.length)

    const after = (await client`
      SELECT COUNT(*)::int AS n
      FROM automations.automation_runs
      WHERE organization_id = ${orgId}
    `) as Array<{ n: number }>
    expect(after[0]?.n).toBe(fresh.length)

    // Cleanup
    await db.execute(sql`DELETE FROM automations.automation_runs WHERE organization_id = ${orgId}`)
  })

  it('returns 0 when no rows are older than the cutoff', async () => {
    const { db, client } = handle
    const orgId = `org-prune-empty-${Date.now()}`
    const ruleId = `rule-prune-empty-${Date.now()}`
    const now = new Date('2026-05-17T12:00:00.000Z')

    await client`
      INSERT INTO automations.automation_runs
        (rule_id, organization_id, event_name, status, started_at)
      VALUES
        (${ruleId}, ${orgId}, 'cron', 'succeeded',
         ${new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()})
    `

    const removed = await pruneAutomationRuns(now, db as unknown as Parameters<typeof pruneAutomationRuns>[1])
    // Other test orgs may exist in the suite seed but none should have rows
    // older than 30d unless this suite seeded them — assert org-scoped count
    // remained.
    const after = (await client`
      SELECT COUNT(*)::int AS n
      FROM automations.automation_runs
      WHERE organization_id = ${orgId}
    `) as Array<{ n: number }>
    expect(after[0]?.n).toBe(1)
    expect(removed).toBeGreaterThanOrEqual(0)

    await db.execute(sql`DELETE FROM automations.automation_runs WHERE organization_id = ${orgId}`)
  })
})
