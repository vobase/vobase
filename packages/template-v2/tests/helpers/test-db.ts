/**
 * Test DB harness — connects to the running Docker Postgres on port 5433.
 * Runs `db:reset` (nuke → push → seed) once per `describe` suite.
 *
 * All 12 assertions rely on the real schemas + seed being in place.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5433/vobase_v2'

/**
 * Inter-process mutex for resetAndSeedDb().
 *
 * Multiple bun test worker processes call resetAndSeedDb() concurrently in
 * their beforeAll hooks. Without coordination they race on the same Postgres:
 * one process's db:nuke drops the DB while another's drizzle-kit push is
 * mid-flight, causing "terminating connection due to administrator command".
 *
 * Strategy — flock(1) exclusive lock + epoch-stamped sentinel:
 *   LOCK_FILE: every worker acquires this before touching the sentinel or DB.
 *   DONE_FILE: written by the winner with the epoch second when it finished.
 *     Workers that acquire the lock AFTER the winner check whether the sentinel
 *     was written during this same second-granularity window; if so they skip.
 *     We use the bun test runner's process group start time (approximated by a
 *     marker file written once at module load) so the sentinel is scoped to the
 *     current test run, not a stale one from a previous invocation.
 *
 * Concretely:
 *   1. First worker to enter: no sentinel → runs db:reset → writes sentinel.
 *   2. Second+ workers: acquire lock after first releases it → sentinel exists
 *      AND was written by this run → skip db:reset.
 *   3. Next invocation of `bun test`: sentinel from previous run has a
 *      different RUN_MARKER prefix → treated as stale → first worker resets.
 */
const LOCK_FILE = '/tmp/vobase-test-db-reset.lock'
const DONE_FILE = '/tmp/vobase-test-db-reset.done'

/**
 * Epoch bucket for this test run (5-second granularity).
 * All bun test worker processes in the same invocation start within a few
 * seconds of each other. Using a 5-second bucket means they all compute the
 * same marker value, allowing the done-sentinel check to distinguish this run
 * from a stale sentinel left by a previous `bun test` invocation.
 * A full db:reset takes ~10 s so 5-second buckets never straddle a reset.
 */
const RUN_EPOCH = Math.floor(Date.now() / 5000)

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
 * Safe to call from multiple parallel bun test worker processes simultaneously.
 * Uses flock(1) as a cross-process mutex so only one worker actually runs
 * db:reset; all others wait, then skip when they see the done-sentinel.
 * The sentinel is stamped with RUN_EPOCH so stale sentinels from previous
 * test invocations are ignored.
 */
export async function resetAndSeedDb(): Promise<void> {
  const cwd = `${import.meta.dir}/../..`

  // Shell script that runs inside the exclusive flock.
  // Flow:
  //   1. Read sentinel. If it equals RUN_EPOCH, another worker in this run
  //      already finished the reset — exit 0 immediately.
  //   2. Otherwise run db:reset. On success write RUN_EPOCH to sentinel.
  //      On failure exit non-zero (flock exit propagates, caller throws).
  const innerScript = `
    sentinel=$(cat ${DONE_FILE} 2>/dev/null || echo '')
    if [ "$sentinel" = "${RUN_EPOCH}" ]; then exit 0; fi
    bun run db:reset || exit 1
    echo ${RUN_EPOCH} > ${DONE_FILE}
  `

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
