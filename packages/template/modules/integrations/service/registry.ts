/**
 * Process-wide handle for the integrations vault factory.
 *
 * Cross-module callers (channels' WhatsApp factory) need to look up
 * tenant-side integration secrets without re-deriving DB connections — they
 * call `getVaultFor(organizationId)` to get a per-org `IntegrationsVault`
 * bound to the installed db.
 */

import type { ScopedDb } from '~/runtime'
import { createIntegrationsVault, type IntegrationsVault } from './vault'

let _db: ScopedDb | null = null

export function installVaultRegistry(deps: { db: ScopedDb }): void {
  _db = deps.db
}

export function __resetVaultRegistryForTests(): void {
  _db = null
}

export function getVaultFor(organizationId: string): IntegrationsVault {
  if (!_db) {
    throw new Error('integrations/vault: registry not installed — module init() must run first')
  }
  return createIntegrationsVault({ db: _db, organizationId })
}

/** Internal — auto-provision pulls db from the same registry. */
export function getInstalledDb(): ScopedDb {
  if (!_db) {
    throw new Error('integrations: db handle not installed — module init() must run first')
  }
  return _db
}
