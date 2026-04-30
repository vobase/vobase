#!/usr/bin/env bun
/**
 * db:migrate — runs `drizzle-kit migrate` against DATABASE_URL.
 *
 * Mirrors v1's pattern: `db:reset` chains nuke → migrate → push → seed so
 * committed migrations replay on a fresh DB before any schema drift gets
 * pushed on top. If `drizzle/` has no generated migrations yet, skip
 * cleanly — drizzle-kit refuses to run without a `_journal.json`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const cwd = `${import.meta.dir}/..`
const journal = join(cwd, 'drizzle', 'meta', '_journal.json')

if (!existsSync(journal)) {
  process.stdout.write('→ no migrations yet (drizzle/meta/_journal.json missing) — skipping\n')
  process.exit(0)
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
