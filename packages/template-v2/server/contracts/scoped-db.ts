/**
 * ScopedDb — first-class drizzle handle for observers and mutators.
 *
 * Observers and mutators can persist state via the same drizzle handle the
 * module services already use, without re-deriving tenant-scoping at every
 * call site.
 *
 * Design:
 * - `ScopedDb` is a named alias over `PostgresJsDatabase<Schema>`. The alias
 *   records the intent ("this handle carries tenant-aware call sites") without
 *   broadening the public surface: no extra methods, no runtime brand, no
 *   require-cast escape hatch. Any runtime drizzle handle created via
 *   `drizzle({ client })` is structurally a `ScopedDb` (see test).
 * - `TenantScope` names the tenant-filter carrier shape. The runtime observer/
 *   mutator contexts already expose `tenantId` at the top level; consumers
 *   thread `ctx.tenantId` into explicit `where tenantId = ?` clauses rather
 *   than letting the drizzle handle carry the scope implicitly. This keeps
 *   query plans debuggable and the ScopedDb surface identical to drizzle.
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

/**
 * Contracts-level schema type. Each module owns its own `schema.ts`; the
 * cross-module contracts layer stays module-agnostic and uses the same
 * loose record shape the drizzle postgres-js driver infers for a
 * schema-less `drizzle({ client })` call. Module handlers keep importing
 * their concrete tables directly from their own schema file.
 */
export type Schema = Record<string, unknown>

/**
 * Tenant-filtered drizzle handle. Structurally identical to
 * `PostgresJsDatabase<Schema>` — the alias exists so `MutatorContext.db` and
 * `ObserverContext.db` can be distinguished from a raw drizzle client at the
 * type level without introducing runtime machinery.
 */
export type ScopedDb = PostgresJsDatabase<Schema>

/**
 * Tenant-filter helper shape. Documented here so downstream lanes can
 * consume the same carrier name when threading `tenantId` through service
 * calls that fan out from an observer or mutator context.
 */
export interface TenantScope {
  readonly tenantId: string
}
