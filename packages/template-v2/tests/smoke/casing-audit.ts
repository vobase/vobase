/**
 * Casing audit — exits non-zero if any drive_files row uses lowercase
 * `/profile.md` or `/memory.md` paths.
 *
 * Drive's virtual overlay is case-sensitive: `/PROFILE.md` is the canonical
 * path. If the agent harness materializer or any direct insert ever wrote
 * lowercase variants, the virtual row at `/PROFILE.md` would silently shadow
 * a "real" `/profile.md` row in the UI without staff noticing. This script
 * is a one-shot guard run against the dev DB.
 */

import { driveFiles } from '@modules/drive/schema'
import { sql } from 'drizzle-orm'

import { connectTestDb } from '../helpers/test-db'

async function main(): Promise<number> {
  const dbh = connectTestDb()
  try {
    const rows = await dbh.db
      .select({
        id: driveFiles.id,
        path: driveFiles.path,
        scope: driveFiles.scope,
        scopeId: driveFiles.scopeId,
        organizationId: driveFiles.organizationId,
      })
      .from(driveFiles)
      .where(
        sql`${driveFiles.path} ~ '/profile\\.md|/memory\\.md' AND ${driveFiles.path} != '/PROFILE.md' AND ${driveFiles.path} != '/MEMORY.md' AND ${driveFiles.scope} IN ('contact','staff','agent')`,
      )

    if (rows.length === 0) {
      console.log('[casing-audit] OK — no rogue lowercase /profile.md or /memory.md rows.')
      return 0
    }

    console.error(`[casing-audit] FAIL — ${rows.length} rogue lowercase row(s):`)
    for (const r of rows) {
      console.error(`  ${r.scope}/${r.scopeId} (${r.organizationId}) path=${r.path} id=${r.id}`)
    }
    console.error('[casing-audit] Apply a one-shot data fix in db/seed.ts to normalize paths to uppercase.')
    return 1
  } finally {
    await dbh.teardown()
  }
}

const code = await main()
process.exit(code)
