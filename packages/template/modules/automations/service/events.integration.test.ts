/**
 * Integration tests for the emit() tx-bridge rollback/commit invariant.
 *
 * Slice A.1 go/no-go gate: verifies that writes through `bridgeTxForPgBoss`
 * are durable iff the producer tx commits, and vanish on rollback.
 *
 * Note: this project does not initialize the pgboss schema in the test DB —
 * pg-boss is started by `Bun.serve` at runtime, not by `db:reset`. The bridge
 * invariant is therefore demonstrated using `automations.automation_runs` as
 * the canary table (same Postgres tx semantics, same bridge path).
 *
 * Requires Docker Postgres on :5432 and the automations schema (`db:reset`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import type { TestDbHandle } from '../../../tests/helpers/test-db'
import { connectTestDb, resetAndSeedDb } from '../../../tests/helpers/test-db'
import { emit } from './events'
import { bridgeTxForPgBoss } from './tx-bridge'

const CANARY_EVENT = 'cron'
const CANARY_RULE_ID = 'test-bridge-canary'

// ─── rollback: bridge write + emit → tx rollback → zero new rows ─────────────

describe('emit-rollback integration (Slice A.1 go/no-go gate)', () => {
  let handle: TestDbHandle

  beforeAll(async () => {
    await resetAndSeedDb()
    handle = connectTestDb()
  })

  afterAll(async () => {
    await handle.teardown()
  })

  it('rollback: emit + bridge write → tx rollback → zero new automation_runs rows', async () => {
    const { db, client } = handle

    const before =
      await client`SELECT COUNT(*)::int AS n FROM automations.automation_runs WHERE rule_id = ${CANARY_RULE_ID}`

    await expect(
      db.transaction(async (tx) => {
        // Write a canary row through the bridge (same path pg-boss dispatcher
        // uses for job inserts — proves rollback semantics without requiring
        // the pgboss schema, which is only initialized at server startup).
        const bridged = bridgeTxForPgBoss(tx)
        await bridged.executeSql(
          `INSERT INTO automations.automation_runs (id, rule_id, organization_id, event_name, status)
           VALUES (nanoid(8), $1, 'test-org', $2, 'queued')`,
          [CANARY_RULE_ID, CANARY_EVENT],
        )

        // Also exercise the typed emit path — must not throw.
        await emit('cron', { scheduleId: 'sched-rollback-test', intendedRunAt: new Date().toISOString() }, { tx })

        // Force the tx to roll back.
        throw new Error('forced rollback')
      }),
    ).rejects.toThrow('forced rollback')

    const after =
      await client`SELECT COUNT(*)::int AS n FROM automations.automation_runs WHERE rule_id = ${CANARY_RULE_ID}`

    // The canary row must not have survived the rollback.
    expect(after[0].n).toBe(before[0].n)
  })
})

// ─── commit: bridge write + emit → tx commits → exactly one new row ──────────

describe('emit-commit integration (Slice A.1 go/no-go gate)', () => {
  let handle: TestDbHandle

  beforeAll(() => {
    handle = connectTestDb()
  })

  afterAll(async () => {
    await handle.teardown()
  })

  it('commit: emit + bridge write → tx commit → one new automation_runs row', async () => {
    const { db, client } = handle
    const ruleId = 'test-bridge-commit'

    const before = await client`SELECT COUNT(*)::int AS n FROM automations.automation_runs WHERE rule_id = ${ruleId}`

    await db.transaction(async (tx) => {
      const bridged = bridgeTxForPgBoss(tx)
      await bridged.executeSql(
        `INSERT INTO automations.automation_runs (id, rule_id, organization_id, event_name, status)
         VALUES (nanoid(8), $1, 'test-org', $2, 'queued')`,
        [ruleId, CANARY_EVENT],
      )

      await emit('cron', { scheduleId: 'sched-commit-test', intendedRunAt: new Date().toISOString() }, { tx })
    })

    const after = await client`SELECT COUNT(*)::int AS n FROM automations.automation_runs WHERE rule_id = ${ruleId}`

    // Exactly one new row must appear after the commit.
    expect(after[0].n).toBe(before[0].n + 1)

    // Cleanup: remove canary row so subsequent runs start clean.
    await client`DELETE FROM automations.automation_runs WHERE rule_id = ${ruleId}`
  })
})
