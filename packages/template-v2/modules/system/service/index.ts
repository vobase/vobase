// system service barrel — no domain tables; built-in tables managed by @vobase/core

// biome-ignore lint/suspicious/noExplicitAny: system module only reads built-in @vobase/core tables (no local schema)
type SystemDb = any

interface SystemDeps {
  db: unknown
}

export interface SystemService {
  db: SystemDb
}

export function createSystemService(deps: SystemDeps): SystemService {
  return { db: deps.db as SystemDb }
}

let _currentSystemService: SystemService | null = null

export function installSystemService(svc: SystemService): void {
  _currentSystemService = svc
}

export function __resetSystemServiceForTests(): void {
  _currentSystemService = null
}

export function requireDb(): SystemDb {
  if (!_currentSystemService) {
    throw new Error('system/service: service not installed — call installSystemService() in module init')
  }
  return _currentSystemService.db
}
