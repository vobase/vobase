/**
 * Integration test: budget breach → automated pause + system-actor audit row,
 * then manual resume → second audit row with `actor_kind='user'`.
 *
 * Verifies the end-to-end story for US-013:
 *   1. Drive cost over the cap.
 *   2. Run the budget watcher.
 *   3. Expect rule.paused=true + audit row (actor='system:budget-watcher').
 *   4. Manually resumeRule with a user actor.
 *   5. Expect a second audit row with actor_id matching the user.
 *   6. Re-dispatch an emit; expect status='succeeded' (no longer paused).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { __resetAdminAlertForTests, installAdminAlertDeps } from '@modules/automations/service/admin-alert'
import {
  __resetAutomationsServiceForTests,
  createAutomationsService,
  installAutomationsService,
} from '@modules/automations/service/automations'
import { runBudgetWatcherTick } from '@modules/automations/service/budget-watcher'
import {
  __resetDispatcherForTests,
  dispatchAutomationRun,
  installDispatcher,
} from '@modules/automations/service/dispatcher'
import { sql } from 'drizzle-orm'

import type { TestDbHandle } from '../../../tests/helpers/test-db'
import { connectTestDb, resetAndSeedDb } from '../../../tests/helpers/test-db'

describe('budget pause → audit → manual resume → audit', () => {
  let handle: TestDbHandle

  beforeAll(async () => {
    await resetAndSeedDb()
    handle = connectTestDb()
  }, 60_000)

  beforeEach(() => {
    __resetAutomationsServiceForTests()
    __resetDispatcherForTests()
    __resetAdminAlertForTests()
    installAutomationsService(
      createAutomationsService({
        db: handle.db as unknown as Parameters<typeof createAutomationsService>[0]['db'],
      }),
    )
    installDispatcher({
      db: handle.db as unknown as Parameters<typeof installDispatcher>[0]['db'],
      jobs: {
        async send(): Promise<string> {
          return 'job-x'
        },
        async cancel(): Promise<void> {},
      },
    })
    installAdminAlertDeps({
      db: handle.db as unknown as Parameters<typeof installAdminAlertDeps>[0]['db'],
    })
  })

  afterAll(async () => {
    __resetDispatcherForTests()
    __resetAutomationsServiceForTests()
    __resetAdminAlertForTests()
    if (handle) await handle.teardown()
  })

  it('budget breach pauses (system audit) then manual resume re-enables (user audit)', async () => {
    const { db, client } = handle
    const orgId = `org-pa-${Date.now()}`

    // Seed a $0.50 cap (50 cents) and a fresh cron rule.
    await client`INSERT INTO automations.tenant_budget_caps (organization_id, daily_cap_usd) VALUES (${orgId}, 50)`
    const svc = createAutomationsService({
      db: db as unknown as Parameters<typeof createAutomationsService>[0]['db'],
    })
    const ruleId = await svc.createRule({
      organizationId: orgId,
      name: `pa-rule-${Date.now()}`,
      eventName: 'cron',
      action: { type: 'wake', agentId: 'agt0test01', lane: 'standalone' },
      cron: '* * * * *',
    })

    // Drive cost above $0.50.
    await client`
      INSERT INTO harness.conversation_events
        (conversation_id, organization_id, turn_index, type, cost_usd, ts)
      VALUES
        (${`conv-pa-${orgId}`}, ${orgId}, 0, 'turn_end', 1.0, now())
    `

    // Run watcher.
    await runBudgetWatcherTick({
      db: db as unknown as NonNullable<Parameters<typeof runBudgetWatcherTick>[0]>['db'],
    })

    // Rule paused + system audit row exists.
    let ruleRow = await client`SELECT paused, paused_reason FROM automations.automations WHERE id = ${ruleId}`
    expect(ruleRow[0].paused).toBe(true)
    expect(ruleRow[0].paused_reason).toBe('budget_exceeded')

    const sysAudits = await client`
      SELECT id, actor_id, details FROM audit.audit_log
      WHERE event = 'automations.paused' AND actor_id = 'system:budget-watcher'
        AND details LIKE ${`%${ruleId}%`}
    `
    expect(sysAudits.length).toBeGreaterThanOrEqual(1)

    // Subsequent dispatch through the paused rule → suppressed_paused row.
    await db.transaction(async (tx) => {
      const result = await dispatchAutomationRun({
        ruleId,
        eventName: 'cron',
        payload: { scheduleId: ruleId, intendedRunAt: new Date().toISOString() },
        ctx: { tx },
      })
      expect(result.status).toBe('suppressed_paused')
    })

    // Manual resume by a user actor.
    await svc.resumeRule(ruleId, { actor: { id: 'user:ops-1', kind: 'user' } })

    ruleRow = await client`SELECT paused FROM automations.automations WHERE id = ${ruleId}`
    expect(ruleRow[0].paused).toBe(false)

    const userAudits = await client`
      SELECT id FROM audit.audit_log
      WHERE event = 'automations.resumed' AND actor_id = 'user:ops-1'
        AND details LIKE ${`%${ruleId}%`}
    `
    expect(userAudits.length).toBe(1)

    // Re-dispatch now succeeds.
    await db.transaction(async (tx) => {
      const result = await dispatchAutomationRun({
        ruleId,
        eventName: 'cron',
        payload: { scheduleId: ruleId, intendedRunAt: new Date().toISOString() },
        ctx: { tx },
      })
      expect(result.status).toBe('succeeded')
    })

    // Cleanup
    await db.execute(sql`DELETE FROM harness.conversation_events WHERE organization_id = ${orgId}`)
    await db.execute(sql`DELETE FROM automations.automation_runs WHERE rule_id = ${ruleId}`)
    // Admin-alert runs are written against a sentinel rule id (system:admin-alert) — wipe by org.
    await db.execute(sql`DELETE FROM automations.automation_runs WHERE organization_id = ${orgId}`)
    await db.execute(sql`DELETE FROM automations.automations WHERE id = ${ruleId}`)
    await db.execute(sql`DELETE FROM automations.tenant_budget_caps WHERE organization_id = ${orgId}`)
  })
})
