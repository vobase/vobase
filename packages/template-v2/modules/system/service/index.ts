// system service barrel — no domain tables; built-in tables managed by @vobase/core
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

// biome-ignore lint/suspicious/noExplicitAny: system module only reads built-in @vobase/core tables (no local schema)
type SystemDb = PostgresJsDatabase<any>

let _db: SystemDb | null = null

export function setDb(db: unknown): void {
  _db = db as SystemDb
}

export function requireDb(): SystemDb {
  if (!_db) throw new Error('system/service: db not initialised — call setDb() in module init')
  return _db
}
