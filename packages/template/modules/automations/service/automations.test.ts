/**
 * Unit + integration tests for the US-013 rule-CRUD primitives on
 * `automationsService`. The integration block exercises the
 * pauseRule/resumeRule audit-log invariant against a real DB.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  __resetAutomationsServiceForTests,
  createAutomationsService,
  installAutomationsService,
} from '@modules/automations/service/automations'
import { sql } from 'drizzle-orm'

import type { TestDbHandle } from '../../../tests/helpers/test-db'
import { connectTestDb, resetAndSeedDb } from '../../../tests/helpers/test-db'

describe('automationsService.pauseRule + resumeRule (audit-log invariant)', () => {
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
  }, 60_000)

  afterAll(async () => {
    __resetAutomationsServiceForTests()
    if (handle) await handle.teardown()
  })

  it('pauseRule writes an audit_log row inside the same tx as the UPDATE', async () => {
    const { db, client } = handle

    // Create a rule to act on.
    const orgId = `org-pause-${Date.now()}`
    const ruleId = await createAutomationsService({
      db: db as unknown as Parameters<typeof createAutomationsService>[0]['db'],
    }).createRule({
      organizationId: orgId,
      name: `rule-${Date.now()}`,
      eventName: 'cron',
      action: { type: 'wake', agentId: 'agt0test01', lane: 'standalone' },
      cron: '* * * * *',
    })

    const auditBefore =
      await client`SELECT COUNT(*)::int AS n FROM audit.audit_log WHERE event = 'automations.paused' AND actor_id = 'user:test-pause'`

    await createAutomationsService({
      db: db as unknown as Parameters<typeof createAutomationsService>[0]['db'],
    }).pauseRule(ruleId, 'manual', { actor: { id: 'user:test-pause', kind: 'user' } })

    const ruleRow = await client`SELECT paused, paused_reason FROM automations.automations WHERE id = ${ruleId}`
    expect(ruleRow[0].paused).toBe(true)
    expect(ruleRow[0].paused_reason).toBe('manual')

    const auditAfter =
      await client`SELECT COUNT(*)::int AS n FROM audit.audit_log WHERE event = 'automations.paused' AND actor_id = 'user:test-pause'`
    expect(auditAfter[0].n).toBe(auditBefore[0].n + 1)

    // Cleanup
    await db.execute(sql`DELETE FROM automations.automations WHERE id = ${ruleId}`)
  })

  it('resumeRule writes an audit_log row inside the same tx as the UPDATE', async () => {
    const { db, client } = handle

    const orgId = `org-resume-${Date.now()}`
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

    const auditBefore =
      await client`SELECT COUNT(*)::int AS n FROM audit.audit_log WHERE event = 'automations.resumed' AND actor_id = 'user:test-resume'`

    await createAutomationsService({
      db: db as unknown as Parameters<typeof createAutomationsService>[0]['db'],
    }).resumeRule(ruleId, { actor: { id: 'user:test-resume', kind: 'user' } })

    const ruleRow = await client`SELECT paused, paused_reason FROM automations.automations WHERE id = ${ruleId}`
    expect(ruleRow[0].paused).toBe(false)
    expect(ruleRow[0].paused_reason).toBeNull()

    const auditAfter =
      await client`SELECT COUNT(*)::int AS n FROM audit.audit_log WHERE event = 'automations.resumed' AND actor_id = 'user:test-resume'`
    expect(auditAfter[0].n).toBe(auditBefore[0].n + 1)

    // Cleanup
    await db.execute(sql`DELETE FROM automations.automations WHERE id = ${ruleId}`)
  })
})
