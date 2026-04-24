#!/usr/bin/env bun
/**
 * db:generate — produce a self-contained Drizzle migration.
 *
 * Pipeline:
 *   1. `drizzle-kit generate --name <name>` writes drizzle/<ts>_<name>/migration.sql
 *   2. Prepend db/current.sql fixtures (extensions + nanoid) so a fresh DB
 *      can replay migrations without `db:push` having run first.
 *   3. Append the cross-schema FKs / UNLOGGED / trigram-index statements that
 *      db-apply-extras.ts applies post-push, so `db:migrate` reaches the same
 *      end state as `db:push`.
 *
 * Usage: bun run db:generate [migration-name]
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { processSqlFile } from './utils/process-sql-file'

const name = process.argv[2] ?? `migration_${Date.now()}`
const templateDir = join(import.meta.dir, '..')
const drizzleDir = join(templateDir, 'drizzle')

if (!existsSync(drizzleDir)) mkdirSync(drizzleDir, { recursive: true })

const before = new Set(readdirSync(drizzleDir))

// drizzle-kit generate requires a TTY even with --name; wrap in `script` so
// Bun can spawn it non-interactively. macOS and Linux have different `script`
// argument orders.
const isLinux = process.platform === 'linux'
const cmd = isLinux
  ? ['script', '-qc', `bunx drizzle-kit generate --name ${name}`, '/dev/null']
  : ['script', '-q', '/dev/null', 'bunx', 'drizzle-kit', 'generate', '--name', name]

const proc = Bun.spawnSync(cmd, {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
  cwd: templateDir,
})
if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1)

const newFolder = readdirSync(drizzleDir).find((f) => !before.has(f) && !f.startsWith('.'))
if (!newFolder) {
  process.stdout.write('[db:generate] no new migration folder — schema already in sync\n')
  process.exit(0)
}

const migrationPath = join(drizzleDir, newFolder, 'migration.sql')

const fixtures = await processSqlFile(join(templateDir, 'db', 'current.sql'))
const schema = await Bun.file(migrationPath).text()

// Extras: mirror db-apply-extras.ts. FK ADD CONSTRAINT has no IF NOT EXISTS,
// so wrap each in a DO block that swallows duplicate_object to keep migrations
// idempotent under re-run (drizzle-kit skips already-applied migrations, but
// manual re-runs against a push-seeded DB must not crash).
const extras = `
-- ── post-schema extras (mirrors scripts/db-apply-extras.ts) ──
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE agents.active_wakes SET UNLOGGED;

CREATE INDEX IF NOT EXISTS idx_drive_text_trgm
  ON drive.files
  USING gin ((coalesce(extracted_text,'') || ' ' || coalesce(caption,'')) gin_trgm_ops);

DO $$ BEGIN
  ALTER TABLE messaging.conversations
    ADD CONSTRAINT fk_conv_contact
    FOREIGN KEY (contact_id) REFERENCES contacts.contacts(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE contacts.staff_channel_bindings
    ADD CONSTRAINT fk_staff_channel_instance
    FOREIGN KEY (channel_instance_id) REFERENCES messaging.channel_instances(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE agents.learning_proposals
    ADD CONSTRAINT fk_lp_wake_event
    FOREIGN KEY (wake_event_id) REFERENCES harness.conversation_events(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE drive.files
    ADD CONSTRAINT fk_drive_source_msg
    FOREIGN KEY (source_message_id) REFERENCES messaging.messages(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE harness.threads
    ADD CONSTRAINT fk_threads_agent
    FOREIGN KEY (agent_id) REFERENCES agents.agent_definitions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE harness.audit_wake_map
    ADD CONSTRAINT fk_audit_wake_map_audit
    FOREIGN KEY (audit_log_id) REFERENCES audit.audit_log(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`

await Bun.write(migrationPath, `${fixtures}\n${schema}\n${extras}`)
process.stdout.write(`[db:generate] baked fixtures + extras into ${migrationPath}\n`)
