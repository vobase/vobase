/**
 * Process-wide service singletons.
 *
 * Set once at boot (`app.ts` / `main.ts`), read everywhere. Listeners import
 * `getDb()` / `getRealtime()` / `getLogger()` directly instead of receiving
 * an `ObserverContext`. Wake identity (`organizationId`, `conversationId`,
 * `wakeId`, `turnIndex`) is read from the event's `HarnessBaseFields`.
 */

import type { RealtimeService, ScopedDb } from '@server/common/port-types'
import type { HarnessLogger } from '@vobase/core'

let _db: ScopedDb | undefined
let _realtime: RealtimeService | undefined
let _logger: HarnessLogger | undefined

export function setDb(db: ScopedDb): void {
  _db = db
}

export function getDb(): ScopedDb {
  if (!_db) throw new Error('services.getDb: setDb() was never called — bootstrap order issue')
  return _db
}

export function setRealtime(realtime: RealtimeService): void {
  _realtime = realtime
}

export function getRealtime(): RealtimeService {
  if (!_realtime) throw new Error('services.getRealtime: setRealtime() was never called — bootstrap order issue')
  return _realtime
}

export function setLogger(logger: HarnessLogger): void {
  _logger = logger
}

export function getLogger(): HarnessLogger {
  if (!_logger) throw new Error('services.getLogger: setLogger() was never called — bootstrap order issue')
  return _logger
}

/** Reset for tests — never call from app code. */
export function __resetServicesForTests(): void {
  _db = undefined
  _realtime = undefined
  _logger = undefined
}
