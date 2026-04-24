/**
 * Shared PGlite bootstrappers for smoke + e2e tests.
 *
 * Wraps src/test-helpers.ts with per-suite table creation so each suite
 * materializes only the tables it needs and the suite body stays compact.
 */

import { sql } from 'drizzle-orm'

import { createDatabase, type VobaseDb } from '../../src/db/client'
import { createTestPGlite } from '../../src/test-helpers'

/** Fresh PGlite + drizzle db with all four core schemas present but empty. */
export async function freshDb(): Promise<{ db: VobaseDb }> {
  await createTestPGlite()
  const db = createDatabase('memory://')
  return { db }
}

/** Creates the `infra.webhook_dedup` table on the shared PGlite. */
export async function createWebhookDedupTable(db: VobaseDb): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "infra"."webhook_dedup" (
      id TEXT NOT NULL,
      source TEXT NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (id, source)
    )
  `)
}

/** Creates the `harness.tenant_cost_daily` rollup table. */
export async function createTenantCostDailyTable(db: VobaseDb): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "harness"."tenant_cost_daily" (
      organization_id TEXT NOT NULL,
      date DATE NOT NULL,
      llm_task TEXT NOT NULL,
      tokens_in BIGINT,
      tokens_out BIGINT,
      cache_read_tokens BIGINT,
      cost_usd NUMERIC(12, 4),
      call_count INTEGER,
      PRIMARY KEY (organization_id, date, llm_task)
    )
  `)
}
