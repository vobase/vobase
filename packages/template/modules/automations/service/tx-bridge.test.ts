/**
 * Real-Postgres unit tests for the tx-bridge shim.
 *
 * Assertion 3 (snake_case go/no-go) is the gate for the entire automations
 * plan. If it fails the bridge is incompatible with pg-boss and the plan must
 * pivot to Option δ (outbox). See plan §3 lines 95-165.
 *
 * Requires Docker Postgres on :5432 (docker compose up -d).
 * No db:reset needed — all queries are pure SELECT with no schema dependency.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import type { TestDbHandle } from '../../../tests/helpers/test-db'
import { connectTestDb } from '../../../tests/helpers/test-db'
import { bridgeTxForPgBoss } from './tx-bridge'

// ─── Pre-flight: no postgres({ transform: ... }) in the codebase ────────────
// If a transform is introduced later, pg-boss's rows[0].singleton_key lookups
// will silently mis-key (camelCase vs snake_case). This grep must return zero
// matches at all times.
describe('pre-flight: no postgres transform in codebase', () => {
  it('grep for transform: in postgres() calls returns zero matches', () => {
    const templateRoot = `${import.meta.dir}/../../..`
    const result = Bun.spawnSync(['grep', '-rn', 'transform:', `${templateRoot}/runtime/`, `${templateRoot}/main.ts`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = result.stdout.toString().trim()
    expect(stdout).toBe('')
  })
})

// ─── Bridge assertions ───────────────────────────────────────────────────────
describe('bridgeTxForPgBoss', () => {
  let handle: TestDbHandle

  beforeAll(() => {
    handle = connectTestDb()
  })

  afterAll(async () => {
    if (handle) await handle.teardown()
  })

  it('assertion 1: executeSql returns correct scalar result', async () => {
    const { db } = handle
    await db.transaction(async (tx) => {
      const bridgedDb = bridgeTxForPgBoss(tx)
      const { rows } = await bridgedDb.executeSql('SELECT 1::int AS one')
      expect(rows).toHaveLength(1)
      expect((rows[0] as Record<string, unknown>).one).toBe(1)
    })
  })

  it('assertion 2: executeSql handles parameterized queries', async () => {
    const { db } = handle
    await db.transaction(async (tx) => {
      const bridgedDb = bridgeTxForPgBoss(tx)
      const { rows } = await bridgedDb.executeSql('SELECT $1::text AS name', ['carl'])
      expect(rows).toHaveLength(1)
      expect((rows[0] as Record<string, unknown>).name).toBe('carl')
    })
  })

  it('assertion 3 (GO/NO-GO): snake_case column names survive the bridge', async () => {
    // This is the gate for the entire automations plan. pg-boss inserts use
    // column names like singleton_key — if postgres-js transforms them to
    // camelCase the bridge is incompatible with pg-boss and the plan pivots.
    const { db } = handle
    await db.transaction(async (tx) => {
      const bridgedDb = bridgeTxForPgBoss(tx)
      const { rows } = await bridgedDb.executeSql('SELECT $1::int AS id, $2::text AS singleton_key', [1, 'k'])
      expect(rows).toHaveLength(1)
      // CRITICAL: snake_case must survive — bridge must be compatible with pg-boss.
      // If this assertion fails: snake-case go/no-go FAILED — postgres-js returned
      // camelCase keys — bridge is incompatible with pg-boss; pivot to Option δ (outbox).
      expect(rows[0]).toEqual({ id: 1, singleton_key: 'k' })
    })
  })
})
