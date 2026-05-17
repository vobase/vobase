/**
 * Integration test: paused rule + multiple emits → all suppressed_paused rows
 * + zero wakes enqueued.
 *
 * Drives 5 cron emits through `dispatchAutomationRun` against a paused rule,
 * asserts 5 `automation_runs` rows with `status='suppressed_paused'`, and that
 * the scheduler stub recorded zero `send` calls.
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

function makeSchedulerStub() {
  const calls: Array<{ name: string; data: unknown }> = []
  return {
    calls,
    async send(name: string, data: unknown): Promise<string> {
      calls.push({ name, data })
      return `job-${calls.length}`
    },
    async cancel(): Promise<void> {},
  }
}

describe('paused dispatcher drain', () => {
  let handle: TestDbHandle
  let scheduler: ReturnType<typeof makeSchedulerStub>

  beforeAll(async () => {
    await resetAndSeedDb()
    handle = connectTestDb()
  })

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
    await handle.teardown()
  })

  it('5 emits against a paused rule → 5 suppressed_paused rows + 0 wakes', async () => {
    const { db, client } = handle
    const orgId = `org-drain-${Date.now()}`
    const ruleId = await createAutomationsService({
      db: db as unknown as Parameters<typeof createAutomationsService>[0]['db'],
    }).createRule({
      organizationId: orgId,
      name: `drain-rule-${Date.now()}`,
      eventName: 'cron',
      action: { type: 'wake', agentId: 'agt0test01', lane: 'standalone' },
      paused: true,
      cron: '* * * * *',
    })

    for (let i = 0; i < 5; i++) {
      await db.transaction(async (tx) => {
        const result = await dispatchAutomationRun({
          ruleId,
          eventName: 'cron',
          payload: { scheduleId: ruleId, intendedRunAt: new Date().toISOString() },
          ctx: { tx },
        })
        expect(result.status).toBe('suppressed_paused')
      })
    }

    const runs = await client`SELECT status FROM automations.automation_runs WHERE rule_id = ${ruleId}`
    expect(runs.length).toBe(5)
    for (const row of runs) {
      expect(row.status).toBe('suppressed_paused')
    }
    expect(scheduler.calls.length).toBe(0)

    // Cleanup
    await db.execute(sql`DELETE FROM automations.automation_runs WHERE rule_id = ${ruleId}`)
    await db.execute(sql`DELETE FROM automations.automations WHERE id = ${ruleId}`)
  })
})
