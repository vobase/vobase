/**
 * Team admin-gate — exposes the `requireRole(['owner','admin'])` middleware to
 * handlers that need to gate mutations on org admin/owner role. Built at
 * `module.ts:init` from `ctx.db` (`createRequireRole` needs the scoped db) and
 * resolved lazily so handlers can stay free of factory wiring.
 *
 * Mirrors the channels umbrella's identical pattern (`modules/channels/service/state.ts`).
 */

import { createRequireRole } from '@auth/middleware'
import type { MiddlewareHandler } from 'hono'

import type { ScopedDb } from '~/runtime'

let _requireAdmin: MiddlewareHandler | null = null

export function installTeamAdminGate(deps: { db: ScopedDb }): void {
  _requireAdmin = createRequireRole(deps.db, ['owner', 'admin'])
}

export function __resetTeamAdminGateForTests(): void {
  _requireAdmin = null
}

export function getRequireAdmin(): MiddlewareHandler | null {
  return _requireAdmin
}
