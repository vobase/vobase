/**
 * Integration tests for `dispatchAutomationRun` — verifies status transitions
 * (queued → succeeded | suppressed_paused | failed) and the `automation_runs`
 * row shape that lands inside the producer's tx.
 *
 * Uses the same DB harness as the other integration tests in this module.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  __resetAutomationsServiceForTests,
  createAutomationsService,
  installAutomationsService,
} from '@modules/automations/service/automations'
import {
  __resetDispatcherForTests,
  dispatchAutomationRun,
  installDispatcher,
} from '@modules/automations/service/dispatcher'
import { sql } from 'drizzle-orm'

import type { TestDbHandle } from '../../../tests/helpers/test-db'
import { connectTestDb, resetAndSeedDb } from '../../../tests/helpers/test-db'

// In-memory scheduler stub — we only need to record `send` calls.
function makeSchedulerStub() {
  const calls: Array<{ name: string; data: unknown; jobId: string }> = []
  return {
    calls,
    async send(name: string, data: unknown): Promise<string> {
      const jobId = `job-${calls.length + 1}`
      calls.push({ name, data, jobId })
      return jobId
    },
    async cancel(): Promise<void> {},
  }
}

describe('dispatchAutomationRun', () => {
  let handle: TestDbHandle
  let scheduler: ReturnType<typeof makeSchedulerStub>

  beforeAll(async () => {
    await resetAndSeedDb()
    handle = connectTestDb()
  }, 60_000)

  beforeEach(() => {
    scheduler = makeSchedulerStub()
    __resetAutomationsServiceForTests()
    __resetDispatcherForTests()
    installAutomationsService(
      createAutomationsService({
        db: handle.db as unknown as Parameters<typeof createAutomationsService>[0]['db'],
      }),
    )
    installDispatcher({
      db: handle.db as unknown as Parameters<typeof installDispatcher>[0]['db'],
      jobs: scheduler,
    })
  })

  afterAll(async () => {
    __resetDispatcherForTests()
    __resetAutomationsServiceForTests()
    if (handle) await handle.teardown()
  })

  it('non-paused cron rule → status="succeeded" + scheduler.send called', async () => {
    const { db, client } = handle
    const orgId = `org-disp-${Date.now()}`
    const ruleId = await createAutomationsService({
      db: db as unknown as Parameters<typeof createAutomationsService>[0]['db'],
    }).createRule({
      organizationId: orgId,
      name: `rule-${Date.now()}`,
      eventName: 'cron',
      action: { type: 'wake', agentId: 'agt0test01', lane: 'standalone' },
      cron: '* * * * *',
    })

    await db.transaction(async (tx) => {
      const result = await dispatchAutomationRun({
        ruleId,
        eventName: 'cron',
        payload: { scheduleId: ruleId, intendedRunAt: new Date().toISOString() },
        ctx: { tx },
      })
      expect(result.status).toBe('succeeded')
    })

    const runs =
      await client`SELECT status, wake_id FROM automations.automation_runs WHERE rule_id = ${ruleId} ORDER BY started_at DESC LIMIT 1`
    expect(runs[0].status).toBe('succeeded')
    expect(runs[0].wake_id).not.toBeNull()
    expect(scheduler.calls.length).toBe(1)

    await db.execute(sql`DELETE FROM automations.automation_runs WHERE rule_id = ${ruleId}`)
    await db.execute(sql`DELETE FROM automations.automations WHERE id = ${ruleId}`)
  })

  it('paused rule → status="suppressed_paused" + scheduler.send NOT called', async () => {
    const { db, client } = handle
    const orgId = `org-disp-paused-${Date.now()}`
    const ruleId = await createAutomationsService({
      db: db as unknown as Parameters<typeof createAutomationsService>[0]['db'],
    }).createRule({
      organizationId: orgId,
      name: `rule-${Date.now()}`,
      eventName: 'cron',
      action: { type: 'wake', agentId: 'agt0test01', lane: 'standalone' },
      paused: true,
      cron: '* * * * *',
    })

    await db.transaction(async (tx) => {
      const result = await dispatchAutomationRun({
        ruleId,
        eventName: 'cron',
        payload: { scheduleId: ruleId, intendedRunAt: new Date().toISOString() },
        ctx: { tx },
      })
      expect(result.status).toBe('suppressed_paused')
    })

    const runs =
      await client`SELECT status FROM automations.automation_runs WHERE rule_id = ${ruleId} ORDER BY started_at DESC LIMIT 1`
    expect(runs[0].status).toBe('suppressed_paused')
    expect(scheduler.calls.length).toBe(0)

    await db.execute(sql`DELETE FROM automations.automation_runs WHERE rule_id = ${ruleId}`)
    await db.execute(sql`DELETE FROM automations.automations WHERE id = ${ruleId}`)
  })
})
