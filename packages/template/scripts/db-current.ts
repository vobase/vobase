/**
 * Apply fixtures to the database.
 *
 * Uses DATABASE_URL (Postgres) when set, otherwise falls back to PGlite for local dev.
 *
 * Usage: bun run db:current
 */
import { processSqlFile } from './utils/process-sql-file';

const currentSqlPath = `${import.meta.dir}/../db/current.sql`;
const currentSql = await processSqlFile(currentSqlPath);

console.log('[db:current] Executing fixtures...');

const databaseUrl = process.env.DATABASE_URL;
const isPostgresUrl =
  databaseUrl?.startsWith('postgres://') ||
  databaseUrl?.startsWith('postgresql://');

if (isPostgresUrl) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(databaseUrl!);
  try {
    await sql.unsafe(currentSql);
    console.log('[db:current] Fixtures applied successfully');
  } finally {
    await sql.end();
  }
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { vector } = await import('@electric-sql/pglite/vector');

  const dbPath = databaseUrl || './data/pgdata';
  console.log(`[db:current] Using PGlite at ${dbPath}`);
  const db = new PGlite(dbPath, { extensions: { pgcrypto, vector } });
  await db.exec(currentSql);
  const check = await db.query('SELECT nanoid(12) as id');
  console.log(
    `[db:current] Verified nanoid: ${(check.rows[0] as { id: string }).id}`,
  );
  console.log('[db:current] Fixtures applied successfully (PGlite)');
  await db.close();
}
