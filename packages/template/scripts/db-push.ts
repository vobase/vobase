#!/usr/bin/env bun
/**
 * db:push — 3 steps:
 *   1. Apply fixtures (extensions + nanoid function) from `db/current.sql`
 *   2. Run `drizzle-kit push` (four pgSchemas + core schemas)
 *   3. Apply post-push extras via `scripts/db-apply-extras.ts`
 *      (cross-schema FKs, UNLOGGED active_wakes, pg_trgm GIN index)
 */
import postgres from 'postgres'

import { processSqlFile } from './utils/process-sql-file'

const url = process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5432/vobase'

process.stdout.write('→ applying db/current.sql fixtures\n')
const fixturesPath = `${import.meta.dir}/../db/current.sql`
const fixturesSql = await processSqlFile(fixturesPath)
const admin = postgres(url, { max: 1 })
try {
  await admin.unsafe(fixturesSql)
  process.stdout.write('  ok   fixtures applied\n')
} finally {
  await admin.end()
}

process.stdout.write('→ running drizzle-kit push\n')
const pushResult = Bun.spawnSync(['bun', 'run', 'drizzle-kit', 'push'], {
  stdio: ['inherit', 'inherit', 'inherit'],
  cwd: `${import.meta.dir}/..`,
})
if (pushResult.exitCode !== 0) {
  process.stderr.write('✗ drizzle-kit push failed\n')
  process.exit(pushResult.exitCode ?? 1)
}

process.stdout.write('→ applying extras\n')
const extrasResult = Bun.spawnSync(['bun', 'run', `${import.meta.dir}/db-apply-extras.ts`], {
  stdio: ['inherit', 'inherit', 'inherit'],
  env: { ...process.env, DATABASE_URL: url },
})
if (extrasResult.exitCode !== 0) {
  process.exit(extrasResult.exitCode ?? 1)
}

process.stdout.write('✓ db:push complete\n')
