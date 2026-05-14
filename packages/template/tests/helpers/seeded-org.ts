/**
 * Runtime helper for resolving the seeded organization id in tests.
 *
 * Tests must NOT import compile-time constants for the org id — the seed
 * orchestrator now derives it at runtime (`process.env.PLATFORM_TENANT_ID ??
 * createNanoid()()`), so the value is only stable within a single `db:reset`
 * run, not across processes or deployments.
 *
 * `getSeededOrgId(db)` queries the earliest `auth.organization` row, which is
 * always the tenant org inserted by `scripts/seed.ts`. Each call issues a fresh
 * query so callers always see the current row after a `resetAndSeedDb()`.
 */

import { authOrganization } from '@auth/schema'
import { asc } from 'drizzle-orm'

type DrizzleDb = { select: (...args: unknown[]) => unknown }

/**
 * Returns the seeded organization id by querying the earliest `auth.organization` row.
 * Always issues a fresh query so the result is correct after any `resetAndSeedDb()`.
 */
export async function getSeededOrgId(db: DrizzleDb): Promise<string> {
  const d = db as {
    select: () => {
      from: (t: unknown) => {
        orderBy: (col: unknown) => {
          limit: (n: number) => Promise<Array<{ id: string }>>
        }
      }
    }
  }

  const rows = await d.select().from(authOrganization).orderBy(asc(authOrganization.createdAt)).limit(1)
  const id = rows[0]?.id
  if (!id) throw new Error('getSeededOrgId: no auth.organization row found — did db:reset run?')
  return id
}
