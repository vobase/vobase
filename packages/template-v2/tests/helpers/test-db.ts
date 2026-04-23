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
 */
export async function resetAndSeedDb(): Promise<void> {
  const cwd = `${import.meta.dir}/../..`
  const result = Bun.spawnSync(['bun', 'run', 'db:reset'], {
    cwd,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  if (result.exitCode !== 0) {
    throw new Error(`test-db: bun run db:reset exited ${result.exitCode}`)
  }
}
