/**
 * Integration test: automations seed migration (US-005b).
 *
 * Verifies that every `automation_rules` row has a paired `automations` row
 * with eventName='cron' and that re-running the seed INSERT is idempotent.
 *
 * Requires Docker Postgres on :5432 and a seeded schema (`db:reset`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import type { TestDbHandle } from '../../../tests/helpers/test-db'
import { connectTestDb, resetAndSeedDb } from '../../../tests/helpers/test-db'

describe('automations seed migration (cron rules from automation_rules)', () => {
  let handle: TestDbHandle

  beforeAll(async () => {
    // db:reset applies all migrations + runs seedAutomations(), so the
    // automations table is pre-populated from automation_rules.
    await resetAndSeedDb()
    handle = connectTestDb()
  })

  afterAll(async () => {
    await handle.teardown()
  })

  it('every automation_rules row has a paired automations row with eventName=cron', async () => {
    const { client } = handle

    const sourceRows =
      await client`SELECT id, organization_id, slug, agent_id, enabled FROM automations.automation_rules ORDER BY id`

    // The seed populates automation_rules with 3 schedules (daily-brief,
    // stale-triage, refund-volume-watch). If none exist, the test DB seed
    // pipeline is broken — fail explicitly.
    expect(sourceRows.length).toBeGreaterThan(0)

    for (const src of sourceRows) {
      const matching = await client`
        SELECT event_name, action, paused
        FROM automations.automations
        WHERE organization_id = ${src.organization_id} AND name = ${src.slug}
      `
      expect(matching.length).toBe(1)
      expect(matching[0].event_name).toBe('cron')
      expect(matching[0].action).toMatchObject({ type: 'wake', agentId: src.agent_id, lane: 'standalone' })
      expect(matching[0].paused).toBe(!src.enabled)
    }
  })

  it('seed is idempotent: re-running INSERT ... ON CONFLICT DO NOTHING is a no-op', async () => {
    const { client } = handle

    const beforeCount = await client`SELECT COUNT(*)::int AS n FROM automations.automations`

    // Re-run the seed SQL inline — matches seedAutomations() logic exactly.
    await client`
      INSERT INTO "automations"."automations" (id, organization_id, name, event_name, action, paused, cron, created_at, updated_at)
      SELECT
        id,
        organization_id,
        slug AS name,
        'cron' AS event_name,
        jsonb_build_object('type', 'wake', 'agentId', agent_id, 'lane', 'standalone') AS action,
        (NOT enabled) AS paused,
        cron,
        created_at,
        updated_at
      FROM "automations"."automation_rules"
      ON CONFLICT (organization_id, name) DO NOTHING
    `

    const afterCount = await client`SELECT COUNT(*)::int AS n FROM automations.automations`

    // Count must be unchanged — no duplicate rows inserted.
    expect(afterCount[0].n).toBe(beforeCount[0].n)
  })
})
