/**
 * Integration test: budget-watcher (US-013).
 *
 * Seeds `harness.conversation_events` for an org with cost summing over its
 * `tenant_budget_caps` row, runs `runBudgetWatcherTick()`, and asserts:
 *   - every non-paused automation rule for the org is now paused with
 *     reason='budget_exceeded';
 *   - an `audit.audit_log` row landed with event='automations.paused' and
 *     actor_id='system:budget-watcher' for each rule.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { __resetAdminAlertForTests, installAdminAlertDeps } from '@modules/automations/service/admin-alert'
import {
  __resetAutomationsServiceForTests,
  createAutomationsService,
  installAutomationsService,
} from '@modules/automations/service/automations'
import { runBudgetWatcherTick } from '@modules/automations/service/budget-watcher'
import { sql } from 'drizzle-orm'

import type { TestDbHandle } from '../../../tests/helpers/test-db'
import { connectTestDb, resetAndSeedDb } from '../../../tests/helpers/test-db'

describe('budget-watcher tick', () => {
  let handle: TestDbHandle

  beforeAll(async () => {
    await resetAndSeedDb()
    handle = connectTestDb()
    __resetAutomationsServiceForTests()
    installAutomationsService(
      createAutomationsService({
        db: handle.db as unknown as Parameters<typeof createAutomationsService>[0]['db'],
      }),
    )
    __resetAdminAlertForTests()
    installAdminAlertDeps({
      db: handle.db as unknown as Parameters<typeof installAdminAlertDeps>[0]['db'],
    })
  })

  afterAll(async () => {
    __resetAutomationsServiceForTests()
    __resetAdminAlertForTests()
    await handle.teardown()
  })

  it('pauses every non-paused rule when spend exceeds cap and writes system-actor audit rows', async () => {
    const { db, client } = handle
    const orgId = `org-watcher-${Date.now()}`

    // Seed: one tenant cap of $1 (100 cents) and one cron rule.
    await client`INSERT INTO automations.tenant_budget_caps (organization_id, daily_cap_usd) VALUES (${orgId}, 100)`

    const ruleId = await createAutomationsService({
      db: db as unknown as Parameters<typeof createAutomationsService>[0]['db'],
    }).createRule({
      organizationId: orgId,
      name: `watch-rule-${Date.now()}`,
      eventName: 'cron',
      action: { type: 'wake', agentId: 'agt0test01', lane: 'standalone' },
      cron: '* * * * *',
    })

    // Seed today's cost over the $1 cap. cost_usd is numeric(10,6).
    // Use a conversation_id literal and synthesize a row.
    await client`
      INSERT INTO harness.conversation_events
        (conversation_id, organization_id, turn_index, type, cost_usd, ts)
      VALUES
        (${`conv-watcher-${orgId}`}, ${orgId}, 0, 'turn_end', 2.0, now())
    `

    const auditBefore = await client`
      SELECT COUNT(*)::int AS n
      FROM audit.audit_log
      WHERE event = 'automations.paused'
        AND actor_id = 'system:budget-watcher'
        AND details LIKE ${`%${orgId}%`}
    `

    const summary = await runBudgetWatcherTick({
      db: db as unknown as NonNullable<Parameters<typeof runBudgetWatcherTick>[0]>['db'],
    })
    const row = summary.find((s) => s.orgId === orgId)
    expect(row).toBeDefined()
    expect(row?.breached).toBe(true)
    expect(row?.pausedRuleIds).toContain(ruleId)

    // Rule is now paused.
    const ruleRows = await client`SELECT paused, paused_reason FROM automations.automations WHERE id = ${ruleId}`
    expect(ruleRows[0].paused).toBe(true)
    expect(ruleRows[0].paused_reason).toBe('budget_exceeded')

    // Audit log row landed with system actor.
    const auditAfter = await client`
      SELECT COUNT(*)::int AS n
      FROM audit.audit_log
      WHERE event = 'automations.paused'
        AND actor_id = 'system:budget-watcher'
        AND details LIKE ${`%${orgId}%`}
    `
    expect(auditAfter[0].n).toBe(auditBefore[0].n + 1)

    // Cleanup
    await db.execute(sql`DELETE FROM harness.conversation_events WHERE organization_id = ${orgId}`)
    // Admin-alert (US-015) inserts run rows under a sentinel rule id — wipe by org.
    await db.execute(sql`DELETE FROM automations.automation_runs WHERE organization_id = ${orgId}`)
    await db.execute(sql`DELETE FROM automations.automations WHERE id = ${ruleId}`)
    await db.execute(sql`DELETE FROM automations.tenant_budget_caps WHERE organization_id = ${orgId}`)
  })
})
