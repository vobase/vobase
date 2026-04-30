import { createRequire } from 'node:module'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { vector } from '@electric-sql/pglite/vector'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'

const requireForCjs = createRequire(import.meta.url)

/**
 * Lazy-load `drizzle-orm/bun-sql` — its mysql/driver.js requires the `'bun'`
 * builtin at module load, which crashes under Node (drizzle-kit walks the
 * schema graph under Node and pulls this file transitively via the
 * `@vobase/core` barrel re-export). Defer the require until `createDatabase`
 * is actually called with a postgres URL.
 */
let _drizzleBunSql: ((opts: { client: unknown }) => unknown) | undefined
function _getDrizzleBunSql(): (opts: { client: unknown }) => unknown {
  if (_drizzleBunSql) return _drizzleBunSql
  const mod = requireForCjs('drizzle-orm/bun-sql') as { drizzle: (opts: { client: unknown }) => unknown }
  _drizzleBunSql = mod.drizzle
  return _drizzleBunSql
}

export type VobaseDb = ReturnType<typeof drizzlePglite>

// Cache PGlite instances for test usage (memory://)
const pgliteCache = new Map<string, PGlite>()
const dbCache = new Map<string, VobaseDb>()

/** Returns the cached PGlite instance (test usage only). */
export function getPgliteClient(dbPath: string): PGlite | undefined {
  return pgliteCache.get(dbPath)
}

/**
 * Resolve `Bun.SQL` lazily — `import 'bun'` at module load fails under Node
 * (drizzle-kit walks the schema graph under Node and pulls this file
 * transitively via the `@vobase/core` barrel re-export). Resolving at call
 * time keeps the schema graph load-safe; the postgres branch only fires when
 * an actual app boots under Bun.
 */
function getBunSqlCtor(): new (opts: Record<string, unknown>) => unknown {
  const bunGlobal = (globalThis as { Bun?: { SQL?: unknown } }).Bun
  const Ctor = bunGlobal?.SQL
  if (!Ctor) {
    throw new Error(
      "createDatabase requires Bun's SQL client; this code path is only available when running under Bun.",
    )
  }
  return Ctor as ReturnType<typeof getBunSqlCtor>
}

export function createDatabase(dbPath: string): VobaseDb {
  if (dbPath.startsWith('postgres://') || dbPath.startsWith('postgresql://')) {
    const SQL = getBunSqlCtor()
    const drizzleBunSql = _getDrizzleBunSql()
    const client = new SQL({
      url: dbPath,
      max: 20,
      idleTimeout: 20,
      maxLifetime: 1800,
      connectionTimeout: 30,
    })
    return drizzleBunSql({ client }) as unknown as VobaseDb
  }

  // PGlite — only for tests (memory://)
  const cached = dbCache.get(dbPath)
  if (cached) return cached

  const pglite = new PGlite(dbPath, {
    extensions: { vector, pgcrypto },
  })
  pgliteCache.set(dbPath, pglite)
  const db = drizzlePglite({ client: pglite })
  dbCache.set(dbPath, db)
  return db
}
