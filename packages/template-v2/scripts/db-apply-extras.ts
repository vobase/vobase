#!/usr/bin/env bun
/**
 * Post-`drizzle-kit push` extras:
 *   1. Cross-schema FKs that drizzle-kit can't express in the TypeScript DSL
 *      (inbox.conversations.contact_id → contacts.contacts.id, etc.)
 *   2. `SET UNLOGGED` on agents.active_wakes (ephemeral coordination per spec §Q9)
 *   3. `CREATE EXTENSION pg_trgm` + GIN index on drive.files
 *
 * Idempotent: every statement uses `IF NOT EXISTS` / `DO ... EXCEPTION` guards.
 * Run order (plan §R7): contacts → inbox → agents → drive.
 */
import postgres from 'postgres'

const url = process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5433/vobase_v2'
const sql = postgres(url, { max: 1 })

async function safeExec(label: string, stmt: string): Promise<void> {
  try {
    await sql.unsafe(stmt)
    process.stdout.write(`  ok   ${label}\n`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Post-push idempotency: skip "already exists" / "duplicate object" noise
    if (/already exists|duplicate_object/i.test(msg)) {
      process.stdout.write(`  skip ${label} (already present)\n`)
      return
    }
    throw err
  }
}

async function main(): Promise<void> {
  process.stdout.write('→ applying post-push extras\n')

  // ── Extensions ────────────────────────────────────────────────────────
  await safeExec('CREATE EXTENSION pg_trgm', 'CREATE EXTENSION IF NOT EXISTS pg_trgm')

  // ── UNLOGGED active_wakes ─────────────────────────────────────────────
  await safeExec('SET UNLOGGED agents.active_wakes', 'ALTER TABLE agents.active_wakes SET UNLOGGED')

  // ── Trigram GIN index on drive.files for grep acceleration ────────────
  await safeExec(
    'CREATE idx_drive_text_trgm',
    `CREATE INDEX IF NOT EXISTS idx_drive_text_trgm
     ON drive.files
     USING gin ((coalesce(extracted_text,'') || ' ' || coalesce(caption,'')) gin_trgm_ops)`,
  )

  // ── Cross-schema FKs (push order: contacts → inbox → agents → drive) ──
  await safeExec(
    'FK inbox.conversations.contact_id → contacts.contacts(id)',
    `ALTER TABLE inbox.conversations
     ADD CONSTRAINT fk_conv_contact
     FOREIGN KEY (contact_id) REFERENCES contacts.contacts(id) ON DELETE RESTRICT`,
  )
  await safeExec(
    'FK contacts.staff_channel_bindings.channel_instance_id → inbox.channel_instances(id)',
    `ALTER TABLE contacts.staff_channel_bindings
     ADD CONSTRAINT fk_staff_channel_instance
     FOREIGN KEY (channel_instance_id) REFERENCES inbox.channel_instances(id) ON DELETE CASCADE`,
  )
  await safeExec(
    'FK agents.learning_proposals.wake_event_id → agents.conversation_events(id)',
    `ALTER TABLE agents.learning_proposals
     ADD CONSTRAINT fk_lp_wake_event
     FOREIGN KEY (wake_event_id) REFERENCES agents.conversation_events(id) ON DELETE SET NULL`,
  )
  await safeExec(
    'FK drive.files.source_message_id → inbox.messages(id)',
    `ALTER TABLE drive.files
     ADD CONSTRAINT fk_drive_source_msg
     FOREIGN KEY (source_message_id) REFERENCES inbox.messages(id) ON DELETE SET NULL`,
  )

  // ── audit_wake_map → core _audit.audit_log (optional — core owns the table) ──
  await safeExec(
    'FK agents.audit_wake_map.audit_log_id → audit.audit_log(id)',
    `ALTER TABLE agents.audit_wake_map
     ADD CONSTRAINT fk_audit_wake_map_audit
     FOREIGN KEY (audit_log_id) REFERENCES audit.audit_log(id) ON DELETE CASCADE`,
  )

  process.stdout.write('→ extras applied\n')
  await sql.end()
}

await main()
