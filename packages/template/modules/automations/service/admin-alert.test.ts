/**
 * Integration test: dispatchAdminAlert (US-015 / Slice D.3).
 *
 * Verifies the 1-hour `(kind, dedupKey)` dedup contract:
 *   - first dispatch → `status='sent'` + automation_runs(status='succeeded').
 *   - second dispatch with same dedupKey within 1h →
 *       `status='suppressed_cooldown'` + automation_runs(status='suppressed_cooldown',
 *        payload_snapshot.reason='admin_alert_dedup').
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  __resetAdminAlertForTests,
  ADMIN_ALERT_EVENT_NAME,
  dispatchAdminAlert,
  installAdminAlertDeps,
} from '@modules/automations/service/admin-alert'
import { sql } from 'drizzle-orm'

import type { TestDbHandle } from '../../../tests/helpers/test-db'
import { connectTestDb, resetAndSeedDb } from '../../../tests/helpers/test-db'

describe('dispatchAdminAlert', () => {
  let handle: TestDbHandle

  beforeAll(async () => {
    await resetAndSeedDb()
    handle = connectTestDb()
  })

  beforeEach(() => {
    __resetAdminAlertForTests()
    installAdminAlertDeps({
      db: handle.db as unknown as Parameters<typeof installAdminAlertDeps>[0]['db'],
    })
  })

  afterAll(async () => {
    __resetAdminAlertForTests()
    await handle.teardown()
  })

  it('first call returns "sent" + writes succeeded run; second call within 1h returns "suppressed_cooldown"', async () => {
    const { db, client } = handle
    const orgId = `org-alert-${Date.now()}`
    const dedupKey = `budget_breach:${orgId}:2026-05-17`

    // First dispatch — should send.
    const first = await dispatchAdminAlert({
      orgId,
      kind: 'budget_breach',
      bodyText: 'Daily budget cap of $1.00 exceeded ($2.00 spent). All automations paused.',
      dedupKey,
    })
    expect(first.status).toBe('sent')

    const sentRows = await client`
      SELECT status, payload_snapshot
      FROM automations.automation_runs
      WHERE organization_id = ${orgId}
        AND event_name = ${ADMIN_ALERT_EVENT_NAME}
      ORDER BY started_at DESC
    `
    expect(sentRows.length).toBe(1)
    expect(sentRows[0].status).toBe('succeeded')
    expect((sentRows[0].payload_snapshot as { dedupKey?: string }).dedupKey).toBe(dedupKey)

    // Second dispatch immediately after — should suppress on dedupKey match.
    const second = await dispatchAdminAlert({
      orgId,
      kind: 'budget_breach',
      bodyText: 'duplicate body — should be suppressed',
      dedupKey,
    })
    expect(second.status).toBe('suppressed_cooldown')

    const allRows = await client`
      SELECT status, payload_snapshot
      FROM automations.automation_runs
      WHERE organization_id = ${orgId}
        AND event_name = ${ADMIN_ALERT_EVENT_NAME}
      ORDER BY started_at ASC
    `
    expect(allRows.length).toBe(2)
    expect(allRows[1].status).toBe('suppressed_cooldown')
    expect((allRows[1].payload_snapshot as { reason?: string }).reason).toBe('admin_alert_dedup')

    // Cleanup
    await db.execute(sql`DELETE FROM automations.automation_runs WHERE organization_id = ${orgId}`)
  })

  it('dispatch with same dedupKey but past the 1h window does not suppress', async () => {
    const { db, client } = handle
    const orgId = `org-alert-window-${Date.now()}`
    const dedupKey = `budget_breach:${orgId}:2026-05-17`

    // Plant a "prior" succeeded row that's 70 minutes old.
    const priorStart = new Date(Date.now() - 70 * 60 * 1000)
    await client`
      INSERT INTO automations.automation_runs
        (rule_id, organization_id, event_name, status, started_at, finished_at,
         payload_snapshot)
      VALUES
        ('system:admin-alert', ${orgId}, ${ADMIN_ALERT_EVENT_NAME}, 'succeeded',
         ${priorStart.toISOString()}, ${priorStart.toISOString()},
         ${JSON.stringify({ dedupKey, kind: 'budget_breach' })}::jsonb)
    `

    const result = await dispatchAdminAlert({
      orgId,
      kind: 'budget_breach',
      bodyText: 'fresh body',
      dedupKey,
    })
    expect(result.status).toBe('sent')

    await db.execute(sql`DELETE FROM automations.automation_runs WHERE organization_id = ${orgId}`)
  })
})
