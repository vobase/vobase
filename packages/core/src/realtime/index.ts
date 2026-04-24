import type { PGlite } from '@electric-sql/pglite'
import { type SQL, sql } from 'drizzle-orm'

import type { VobaseDb } from '../db/client'
import { getPgliteClient } from '../db/client'
import { logger } from '../logger'

const CHANNEL = 'vobase_events'

export interface RealtimePayload {
  table: string
  id?: string
  action?: string
  tab?: string
  prevTab?: string
}

/** Minimal interface satisfied by both VobaseDb and Drizzle transaction handles. */
export type RealtimeExecutor = { execute: (query: SQL) => Promise<unknown> }

export interface RealtimeService {
  /** Subscribe to invalidation events. Returns unsubscribe function. */
  subscribe(fn: (payload: string) => void): () => void

  /** Emit a NOTIFY event. Optional tx for transactional guarantees. */
  notify(payload: RealtimePayload, tx?: RealtimeExecutor): Promise<void>

  /** Clean up LISTEN connection and subscribers. */
  shutdown(): Promise<void>
}

type Subscriber = (payload: string) => void

export interface CreateRealtimeOptions {
  /**
   * Dedicated DSN for the LISTEN connection. Use this on Neon (or any
   * PgBouncer-fronted deploy) where the app pool hits the `-pooler` endpoint
   * in transaction mode — pooled sessions cannot deliver NOTIFY to a LISTEN
   * on a different backend session. Point this at the direct (non-pooler)
   * endpoint so the listener gets its own persistent backend. Defaults to
   * `databaseConfig`.
   */
  listenDsn?: string
}

/**
 * Create a RealtimeService backed by PostgreSQL LISTEN/NOTIFY.
 */
export async function createRealtimeService(
  databaseConfig: string,
  db: VobaseDb,
  opts: CreateRealtimeOptions = {},
): Promise<RealtimeService> {
  const subscribers = new Set<Subscriber>()

  const dispatch = (payload: string) => {
    for (const fn of subscribers) {
      try {
        fn(payload)
      } catch {
        // subscriber errors must not crash the dispatch loop
      }
    }
  }

  // Non-Postgres string (e.g. 'memory://') — use PGlite LISTEN/NOTIFY
  if (!databaseConfig.startsWith('postgres://') && !databaseConfig.startsWith('postgresql://')) {
    const pglite = getPgliteClient(databaseConfig)
    if (pglite) {
      return createPgliteRealtime(pglite, db, subscribers, dispatch)
    }
    return createNoopRealtime()
  }

  try {
    return await createPostgresRealtime(databaseConfig, db, subscribers, dispatch, opts.listenDsn)
  } catch (err) {
    logger.warn('[realtime] Failed to initialize — falling back to no-op service:', err)
    return createNoopRealtime()
  }
}

async function createPostgresRealtime(
  databaseConfig: string,
  db: VobaseDb,
  subscribers: Set<Subscriber>,
  dispatch: (payload: string) => void,
  listenDsn?: string,
): Promise<RealtimeService> {
  // biome-ignore lint/plugin/no-dynamic-import: skip loading the `postgres` driver when PGlite or no-op paths are taken at boot
  const postgres = (await import('postgres')).default
  const dsn = listenDsn ?? databaseConfig
  const listenConn = postgres(dsn, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 30,
  })

  // postgres.js auto-re-issues LISTEN on reconnect; `onlisten` fires on the
  // initial subscribe AND every re-subscribe after a connection drop. We log
  // the latter so silent LISTEN-loss becomes visible in ops.
  let listenCount = 0
  await listenConn.listen(
    CHANNEL,
    (payload) => {
      dispatch(payload)
    },
    () => {
      listenCount++
      if (listenCount > 1) {
        logger.info(`[realtime] LISTEN re-established on channel ${CHANNEL} (count=${listenCount})`)
      }
    },
  )

  // Keepalive: on backends with compute autosuspend (Neon) or proxy idle
  // timeouts, an idle LISTEN socket gets reaped. A periodic SELECT 1 *on the
  // listen connection itself* keeps its TCP socket active and the upstream
  // compute warm, preventing silent SSE blackout after idle periods.
  const keepaliveMsRaw = Number(process.env.VOBASE_REALTIME_KEEPALIVE_MS ?? 60_000)
  const keepaliveMs = Number.isFinite(keepaliveMsRaw) ? keepaliveMsRaw : 60_000
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null
  if (keepaliveMs > 0) {
    keepaliveTimer = setInterval(() => {
      listenConn`SELECT 1`.catch((err: unknown) => {
        logger.warn('[realtime] keepalive ping failed:', err)
      })
    }, keepaliveMs)
    keepaliveTimer.unref?.()
  }

  return {
    subscribe(fn) {
      subscribers.add(fn)
      return () => {
        subscribers.delete(fn)
      }
    },

    async notify(payload, tx) {
      const json = JSON.stringify(payload)
      const notifyQuery = sql`SELECT pg_notify(${CHANNEL}, ${json})`
      if (tx) {
        await tx.execute(notifyQuery)
      } else {
        await db.execute(notifyQuery)
      }
    },

    async shutdown() {
      if (keepaliveTimer) clearInterval(keepaliveTimer)
      await listenConn.end()
      subscribers.clear()
    },
  }
}

async function createPgliteRealtime(
  pglite: PGlite,
  db: VobaseDb,
  subscribers: Set<Subscriber>,
  dispatch: (payload: string) => void,
): Promise<RealtimeService> {
  const unsub = await pglite.listen(CHANNEL, (payload) => {
    dispatch(payload)
  })

  return {
    subscribe(fn) {
      subscribers.add(fn)
      return () => {
        subscribers.delete(fn)
      }
    },

    async notify(payload, tx) {
      const json = JSON.stringify(payload)
      const notifyQuery = sql`SELECT pg_notify(${CHANNEL}, ${json})`
      if (tx) {
        await tx.execute(notifyQuery)
      } else {
        await db.execute(notifyQuery)
      }
    },

    async shutdown() {
      unsub()
      subscribers.clear()
    },
  }
}

/** No-op fallback when LISTEN/NOTIFY initialization fails at boot. */
export function createNoopRealtime(): RealtimeService {
  return {
    subscribe() {
      return () => {}
    },
    async notify() {},
    async shutdown() {},
  }
}
