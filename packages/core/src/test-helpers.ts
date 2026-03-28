/**
 * PGlite test helper — creates in-memory instances with core schemas.
 *
 * PGlite has limited support for concurrent in-memory instances in a single
 * process (electric-sql/pglite#324).
 */
import { PGlite } from '@electric-sql/pglite';

/** Create a fresh in-memory PGlite instance with core schemas. */
export async function createTestPGlite(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.waitReady;
  await pg.query('CREATE SCHEMA IF NOT EXISTS "auth"');
  await pg.query('CREATE SCHEMA IF NOT EXISTS "audit"');
  await pg.query('CREATE SCHEMA IF NOT EXISTS "infra"');
  return pg;
}
