/**
 * Test DB harness — connects to the running Docker Postgres on port 5432.
 * Runs `db:reset` (nuke → push → seed) once per `describe` suite.
 *
 * All 12 assertions rely on the real schemas + seed being in place.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5432/vobase'

/**
 * Inter-process mutex for resetAndSeedDb().
 *
 * Each test file's beforeAll calls resetAndSeedDb() to get a clean seeded DB.
 * The flock serialises resets across parallel bun test worker processes — only
 * one nuke+push+seed runs at a time, others wait — so the sequence stays sane
 * even when several files start their setup near-simultaneously.
 *
 * NOTE: a previous design cached the reset result via an epoch-stamped
 * sentinel so files arriving within ~5s of a successful reset would skip.
 * That optimisation was unsound — tests that mutate seed rows leave a
 * polluted DB for the next file. The skip is gone; correctness over speed.
 * If suite latency becomes a concern, swap the subprocess full-reset for an
 * in-process TRUNCATE ... CASCADE + reseed (see voltade/vobase#69).
 */
const LOCK_FILE = '/tmp/vobase-test-db-reset.lock'

export interface TestDbHandle {
  client: postgres.Sql
  db: ReturnType<typeof drizzle>
  url: string
  teardown: () => Promise<void>
}

export function connectTestDb(): TestDbHandle {
  const client = postgres(TEST_DB_URL, { max: 5 })
  // drizzle-orm 1.0 beta accepts a url string or { client } — use the client adapter
  const db = drizzle({ client })
  return {
    client,
    db,
    url: TEST_DB_URL,
    teardown: async () => {
      await client.end()
    },
  }
}

/**
 * Full reset + seed. Runs via the package's `db:reset` script so push ordering
 * (contacts → messaging → agents → drive) + extras (FKs, UNLOGGED, pg_trgm) stay in
 * sync with the canonical pipeline.
 *
 * Safe to call from multiple parallel bun test worker processes simultaneously
 * AND from each test file's beforeAll. Uses flock(1) as a cross-process mutex
 * to serialise resets — every caller gets a fresh seed, no shared state.
 */
export async function resetAndSeedDb(): Promise<void> {
  const cwd = `${import.meta.dir}/../..`

  // Always reset under the flock. Cross-test-file pollution is the failure
  // mode we're guarding against; runtime cost is acceptable (~3s/file × ~20
  // files = ~60s extra, suite stays under a couple of minutes).
  const innerScript = `bun run db:reset || exit 1`

  // lockf(1) is available on macOS; flock(1) on Linux. Both acquire an
  // exclusive advisory lock on LOCK_FILE for the duration of the child process.
  const lockCmd = process.platform === 'darwin' ? 'lockf' : 'flock'
  const lockArgs =
    process.platform === 'darwin'
      ? [LOCK_FILE, 'sh', '-c', innerScript] // lockf <file> <cmd> [args]
      : ['-x', LOCK_FILE, 'sh', '-c', innerScript] // flock -x <file> <cmd> [args]

  const result = Bun.spawnSync([lockCmd, ...lockArgs], {
    cwd,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (result.exitCode !== 0) {
    throw new Error(`test-db: resetAndSeedDb exited ${result.exitCode}`)
  }
}
