/**
 * Pg-boss job seam for `pruneAutomationRuns` (US-015 / Slice D.3).
 *
 * The pure function lives in `runs-prune.ts`; this file owns the boot-time
 * `installRunsPruneDb()` lifecycle so the pg-boss handler can grab the
 * scoped DB without re-importing the module init context.
 */

import { logger } from '@vobase/core'

import type { ScopedDb } from '~/runtime'
import { pruneAutomationRuns } from './runs-prune'

let _installedDb: ScopedDb | null = null

export function installRunsPruneDb(db: ScopedDb): void {
  _installedDb = db
}

export function __resetRunsPruneDbForTests(): void {
  _installedDb = null
}

/**
 * Drive the prune once. Returns the rowcount the pg-boss handler can log.
 */
export async function runAutomationRunsPrune(): Promise<number> {
  if (!_installedDb) {
    logger.warn('[automations/runs-prune] db not installed — skipping prune (test boot?)')
    return 0
  }
  const removed = await pruneAutomationRuns(new Date(), _installedDb)
  logger.info({ removed }, '[automations/runs-prune] swept rows older than 30 days')
  return removed
}
