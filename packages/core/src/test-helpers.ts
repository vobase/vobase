/**
 * PGlite test helpers — global singleton with schema-based isolation.
 *
 * PGlite only supports one WASM instance per JS thread
 * (electric-sql/pglite#324). This module provides a process-wide singleton
 * created via createDatabase('memory://'), ensuring all test files share
 * the same PGlite and avoiding WASM conflicts.
 *
 * Each test file calls createTestPGlite() in beforeAll() which resets
 * the core schemas (DROP CASCADE + CREATE), giving a clean slate.
 * Individual tests use DELETE/TRUNCATE in beforeEach() for data isolation.
 *
 * NEVER call pglite.close() in tests — process exit handles cleanup.
 */
import type { PGlite } from '@electric-sql/pglite'

import { createDatabase, getPgliteClient } from './db/client'

let shared: PGlite | null = null

const CORE_SCHEMAS = ['auth', 'audit', 'infra', 'harness'] as const

/**
 * Returns a process-wide singleton PGlite instance with pgcrypto + vector
 * extensions. The instance is created via createDatabase('memory://') so it
 * is registered in the client cache — getPgliteClient('memory://') and
 * subsequent createDatabase('memory://') calls reuse the same instance.
 */
export async function getSharedPGlite(): Promise<PGlite> {
  if (!shared) {
    createDatabase('memory://')
    // biome-ignore lint/style/noNonNullAssertion: guaranteed to exist after createDatabase
    shared = getPgliteClient('memory://')!
    await shared.waitReady
  }
  return shared
}

/**
 * Returns the shared PGlite with freshly reset core schemas.
 * Call in beforeAll() to give each test file a clean slate.
 * Tables can then be created in the clean schemas.
 */
export async function createTestPGlite(): Promise<PGlite> {
  const pg = await getSharedPGlite()
  for (const s of CORE_SCHEMAS) {
    await pg.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE`)
    await pg.query(`CREATE SCHEMA "${s}"`)
  }
  return pg
}
