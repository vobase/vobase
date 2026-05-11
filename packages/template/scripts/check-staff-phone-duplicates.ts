#!/usr/bin/env bun
/**
 * Pre-migration audit script per parent plan R9-G Scenario G.
 *
 * Runs BEFORE `bun run db:migrate` to ensure no duplicate
 * `(whatsapp_phone_e164, organization_id)` rows exist that would block any
 * UNIQUE-related constraint added in Slice 3 (or break the notification-tier
 * reverse-lookup invariant).
 *
 * Exit 0 if clean (no duplicates, or column not yet present).
 * Exit 1 with a JSON report on stderr if duplicates found — operator must
 * deduplicate before running `db:migrate`.
 */
import postgres from 'postgres'

const url = process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5432/vobase'
const sql = postgres(url, { max: 1 })

interface DuplicateRow {
  whatsapp_phone_e164: string
  organization_id: string
  n: number
}

async function main(): Promise<void> {
  // Skip cleanly if the column hasn't been migrated yet (first run before the
  // Slice 3 migration is applied to a fresh DB).
  const columnRows = await sql<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'team'
        AND table_name = 'staff_profiles'
        AND column_name = 'whatsapp_phone_e164'
    ) AS exists
  `
  if (columnRows[0]?.exists !== true) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, duplicateGroups: 0, note: 'whatsapp_phone_e164 column not present yet' }, null, 2)}\n`,
    )
    await sql.end()
    process.exit(0)
  }

  const rows = await sql<DuplicateRow[]>`
    SELECT whatsapp_phone_e164, organization_id, count(*)::int AS n
    FROM team.staff_profiles
    WHERE whatsapp_phone_e164 IS NOT NULL
    GROUP BY whatsapp_phone_e164, organization_id
    HAVING count(*) > 1
  `

  if (rows.length === 0) {
    process.stdout.write(`${JSON.stringify({ ok: true, duplicateGroups: 0 }, null, 2)}\n`)
    await sql.end()
    process.exit(0)
  }

  process.stderr.write(`${JSON.stringify({ ok: false, duplicateGroups: rows.length, rows }, null, 2)}\n`)
  process.stderr.write(
    '\nDuplicate (whatsapp_phone_e164, organization_id) groups detected. Operator must deduplicate before running db:migrate.\n',
  )
  await sql.end()
  process.exit(1)
}

await main()
