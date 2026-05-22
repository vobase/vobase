#!/usr/bin/env bun
/**
 * db:migrate — runs `drizzle-kit migrate` against DATABASE_URL.
 *
 * Mirrors v1's pattern: `db:reset` chains nuke → migrate → push → seed so
 * committed migrations replay on a fresh DB before any schema drift gets
 * pushed on top. If `drizzle/` has no generated migrations yet, skip
 * cleanly — drizzle-kit has nothing to apply.
 *
 * Detection: any `drizzle/<ts>_<name>/migration.sql` is a migration. drizzle
 * 1.0 tracks applied journal entries in a DB table (`__drizzle_migrations`),
 * not on disk, so we don't look for `drizzle/meta/_journal.json` — that path
 * was for pre-1.0 drizzle-kit and silently skipped every deploy here.
 *
 * Fixtures first: `db/fixtures.sql` (extensions + nanoid + functions +
 * triggers) is applied before `drizzle-kit migrate`, exactly as `db:push`
 * does it. Schema DDL depends on `nanoid()` / pgcrypto / vector — a freshly
 * generated migration only carries that fixture SQL if `db/current.sql`
 * happened to hold it at `db:generate` time, so the deploy path must apply
 * the permanent fixtures itself. `fixtures.sql` is idempotent
 * (`CREATE EXTENSION IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`), so it is
 * safe to re-run on every deploy.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

import { processSqlFile } from './utils/process-sql-file'

const cwd = `${import.meta.dir}/..`
const drizzleDir = join(cwd, 'drizzle')

const hasMigrations =
  existsSync(drizzleDir) &&
  readdirSync(drizzleDir, { withFileTypes: true }).some(
    (e) => e.isDirectory() && existsSync(join(drizzleDir, e.name, 'migration.sql')),
  )

if (!hasMigrations) {
  process.stdout.write('→ no migrations yet (no drizzle/<ts>_<name>/migration.sql found) — skipping\n')
  process.exit(0)
}

const url = process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5432/vobase'

process.stdout.write('→ applying db/fixtures.sql fixtures\n')
const fixturesSql = await processSqlFile(join(cwd, 'db', 'fixtures.sql'))
const admin = postgres(url, { max: 1 })
try {
  await admin.unsafe(fixturesSql)
  process.stdout.write('  ok   fixtures applied\n')
} finally {
  await admin.end()
}

const result = Bun.spawnSync(['bun', 'run', 'drizzle-kit', 'migrate'], {
  stdio: ['inherit', 'inherit', 'inherit'],
  cwd,
})

if (result.exitCode !== 0) {
  process.stderr.write('✗ drizzle-kit migrate failed\n')
  process.exit(result.exitCode ?? 1)
}

process.stdout.write('✓ db:migrate complete\n')
