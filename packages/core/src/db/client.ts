import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { vector } from '@electric-sql/pglite/vector'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'

export type VobaseDb = ReturnType<typeof drizzlePglite>

// Cache PGlite instances for test usage (memory://)
const pgliteCache = new Map<string, PGlite>()
const dbCache = new Map<string, VobaseDb>()

/** Returns the cached PGlite instance (test usage only). */
export function getPgliteClient(dbPath: string): PGlite | undefined {
  return pgliteCache.get(dbPath)
}

export function createDatabase(dbPath: string): VobaseDb {
  if (dbPath.startsWith('postgres://') || dbPath.startsWith('postgresql://')) {
    // Lazy import bun:sql — only available in Bun runtime, not in Node/drizzle-kit
    const { SQL } = require('bun')
    const { drizzle: drizzleBunSql } = require('drizzle-orm/bun-sql')
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
