import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

export type VobaseDb = ReturnType<typeof drizzlePglite>;

// Cache instances by path so multiple createDatabase calls reuse the same PGlite
const pgliteCache = new Map<string, PGlite>();
const dbCache = new Map<string, VobaseDb>();

/** Returns the cached PGlite instance for a local db path, or undefined for postgres URLs. */
export function getPgliteClient(dbPath: string): PGlite | undefined {
  return pgliteCache.get(dbPath);
}

export function createDatabase(dbPath: string): VobaseDb {
  if (dbPath.startsWith('postgres://') || dbPath.startsWith('postgresql://')) {
    // Lazy import bun:sql — only available in Bun runtime, not in Node/drizzle-kit
    const { SQL } = require('bun');
    const { drizzle: drizzleBunSql } = require('drizzle-orm/bun-sql');
    const client = new SQL(dbPath);
    return drizzleBunSql({ client }) as unknown as VobaseDb;
  }

  const cached = dbCache.get(dbPath);
  if (cached) return cached;

  const pglite = new PGlite(dbPath, {
    extensions: { vector, pgcrypto },
  });
  pgliteCache.set(dbPath, pglite);
  const db = drizzlePglite({ client: pglite });
  dbCache.set(dbPath, db);
  return db;
}
