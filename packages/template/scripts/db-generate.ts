#!/usr/bin/env bun
/**
 * db:generate — produce a self-contained Drizzle migration.
 *
 * Pipeline:
 *   1. `drizzle-kit generate --name <name>` writes drizzle/<ts>_<name>/migration.sql
 *   2. Prepend db/current.sql content (any one-off DML you've staged inline)
 *      so it lands in migration history.
 *   3. Reset db/current.sql back to the empty staging template — anything
 *      you staged inline is now baked into the migration history and gone
 *      from current.sql.
 *
 * `current.sql` is TRANSIENT: by default it is an empty staging template.
 * Extensions + nanoid + functions + triggers are NOT in it — they are baked
 * once into the initial migration, so re-baking them on every generate would
 * duplicate ~200 lines of nanoid into every subsequent migration. Stage inline
 * SQL here only when you want it baked into the next migration; after bake it
 * is removed so it doesn't re-run on subsequent generates.
 *
 * Use cases for inline SQL in current.sql:
 *   - Data backfills that must run between schema CREATE and DROP statements
 *   - One-off DML (REINDEX, VACUUM, manual constraint patches)
 *   - Anything that's not a permanent fixture
 *
 * Extras (UNLOGGED active_wakes, audit_wake_map FK) are NOT baked here —
 * they touch the `harness` schema which is only created by `db:push` reading
 * core's schema.ts. `db:reset` runs `migrate → push → apply-extras` so the
 * extras land at the right point. Baking them into the migration would break
 * `migrate` on a fresh DB where the prior migrations don't create harness.
 *
 * Usage: bun run db:generate [migration-name]
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { processSqlFile } from './utils/process-sql-file'

const name = process.argv[2] ?? `migration_${Date.now()}`
const repoDir = join(import.meta.dir, '..')
const drizzleDir = join(repoDir, 'drizzle')

if (!existsSync(drizzleDir)) mkdirSync(drizzleDir, { recursive: true })

const before = new Set(readdirSync(drizzleDir))

// drizzle-kit generate refuses to run without a real TTY (process.stdin.isTTY
// must be true), and any non-trivial schema diff produces "is X a rename of
// Y?" prompts that have no CLI flag to bypass. We drive it via `expect` —
// provides a real pty and auto-presses Enter for every prompt (the highlighted
// default is always "create new", which is the right answer for renames we
// don't want to collapse).
const proc = Bun.spawnSync(['expect', join(import.meta.dir, 'drizzle-generate.exp'), name], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
  cwd: repoDir,
})
if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1)

const newFolder = readdirSync(drizzleDir).find((f) => !before.has(f) && !f.startsWith('.'))
if (!newFolder) {
  process.stdout.write('[db:generate] no new migration folder — schema already in sync\n')
  process.exit(0)
}

const migrationPath = join(drizzleDir, newFolder, 'migration.sql')

const fixtures = await processSqlFile(join(repoDir, 'db', 'current.sql'))
const schema = await Bun.file(migrationPath).text()

await Bun.write(migrationPath, `${fixtures}\n${schema}`)
process.stdout.write(`[db:generate] baked fixtures into ${migrationPath}\n`)

// Reset db/current.sql back to an empty staging template so the inline SQL
// you just baked is now in migration history and gone from current.sql.
// Extensions + nanoid + functions + triggers are NOT re-included on every
// generate — they live in the first migration only (baked once) so we don't
// duplicate ~200 lines of nanoid into every subsequent migration.
const currentSqlPath = join(repoDir, 'db', 'current.sql')
const resetTemplate = `-- One-off DML / DDL staging area
-- Inline SQL here gets prepended to the next \`db:generate\` migration and
-- baked into history; this file resets to empty afterwards. Use --!include
-- to pull in shared SQL fragments via glob.
--
-- Extensions + nanoid + functions + triggers are NOT included here — they
-- already live in the initial migration (baked once at first db:generate)
-- and don't need to re-run on subsequent migrations.
`
await Bun.write(currentSqlPath, resetTemplate)
process.stdout.write('[db:generate] current.sql reset to empty staging template\n')
