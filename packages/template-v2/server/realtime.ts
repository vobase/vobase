/**
 * Realtime service factory — thin wrapper around `@vobase/core`'s
 * `createRealtimeService`.
 *
 * Core owns a singleton LISTEN connection + in-memory subscriber fanout.
 * We adapt its signature to v2's `RealtimeService` contract (sync-void
 * `notify`) so existing call sites stay unchanged.
 *
 * Channel is `vobase_events` (core's default); SSE route subscribes via
 * `realtime.subscribe(fn)` rather than opening its own pg LISTEN.
 *
 * Neon: `DATABASE_URL` points at the `-pooler` endpoint (PgBouncer, tx mode)
 * so app queries get a high connection ceiling. Pooled sessions cannot deliver
 * NOTIFY to LISTEN (different backend sessions), so we route the single
 * listener at `DATABASE_URL_DIRECT` (direct endpoint) when set. Self-hosted
 * Postgres can leave it unset and the pool DSN is reused.
 */

import type { RealtimeService } from '@server/common/port-types'
import type { ScopedDb } from '@server/common/scoped-db'

export async function buildRealtime(databaseConfig: string, db: ScopedDb): Promise<RealtimeService> {
  const { createRealtimeService } = await import('@vobase/core')
  const core = await createRealtimeService(
    databaseConfig,
    db as unknown as Parameters<typeof createRealtimeService>[1],
    { listenDsn: process.env.DATABASE_URL_DIRECT },
  )
  return {
    notify(payload, tx) {
      void core
        .notify(payload, tx as unknown as Parameters<typeof core.notify>[1])
        .catch((err) => console.error('[realtime.notify] failed:', err))
    },
    subscribe(fn) {
      return core.subscribe(fn)
    },
  }
}
