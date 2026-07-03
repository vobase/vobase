import type { PGlite } from '@electric-sql/pglite'
import { type SQL, sql } from 'drizzle-orm'

import type { VobaseDb } from '../db/client'
import { getPgliteClient } from '../db/client'
import { logger } from '../logger'
import { createScopedListener, type ScopedListener } from './lifecycle'

const CHANNEL = 'vobase_events'

/**
 * Broadcast when the LISTEN transport (re)establishes: NOTIFYs emitted while the socket was down were dropped, so subscribers must refetch rather than trust their caches. Consumers treat `table: '*'` as "invalidate everything"; a subscriber that predates this marker sees it as an unknown table and falls through to its broad `[table]` fallback (a harmless no-op invalidate), never an error.
 */
const RESYNC_PAYLOAD = JSON.stringify({ table: '*', action: 'resync' })

export interface RealtimePayload {
  table: string
  id?: string
  action?: string
  tab?: string
  prevTab?: string
  /**
   * Actor identity for transient signals such as `action: 'typing'` —
   * lets recipients render `${userName} is typing…` without a second
   * lookup. Pure passthrough; the core service does not interpret it.
   */
  userId?: string
  userName?: string
}

/** Minimal interface satisfied by both VobaseDb and Drizzle transaction handles. */
export type RealtimeExecutor = { execute: (query: SQL) => Promise<unknown> }

export interface RealtimeService {
  /** Subscribe to invalidation events. Returns unsubscribe function. */
  subscribe(fn: (payload: string) => void): () => void

  /** Emit a NOTIFY event. Optional tx for transactional guarantees. */
  notify(payload: RealtimePayload, tx?: RealtimeExecutor): Promise<void>

  /**
   * Settles once the LISTEN transport for the current subscriber epoch is
   * established (or its attempt has failed — never rejects). Await after
   * `subscribe()` and before acking a client as connected, so the client's
   * post-ack refetch covers events emitted while the transport was starting.
   */
  ready?(): Promise<void>

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
    logger.warn({ err }, '[realtime] Failed to initialize — falling back to no-op service')
    return createNoopRealtime()
  }
}

function buildRealtimeService(
  db: VobaseDb,
  subscribers: Set<Subscriber>,
  teardown: () => Promise<void> | void,
  listener?: ScopedListener,
): RealtimeService {
  return {
    subscribe(fn) {
      subscribers.add(fn)
      listener?.retain()
      let active = true
      return () => {
        // Idempotent — a double unsubscribe must not decrement another subscriber's refcount.
        if (!active) return
        active = false
        subscribers.delete(fn)
        listener?.release()
      }
    },

    async notify(payload, tx) {
      const json = JSON.stringify(payload)
      const notifyQuery = sql`SELECT pg_notify(${CHANNEL}, ${json})`
      await (tx ?? db).execute(notifyQuery)
    },

    ready() {
      return listener?.ready() ?? Promise.resolve()
    },

    async shutdown() {
      await teardown()
      subscribers.clear()
    },
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

  const keepaliveMsRaw = Number(process.env.VOBASE_REALTIME_KEEPALIVE_MS ?? 60_000)
  const keepaliveMs = Number.isFinite(keepaliveMsRaw) ? keepaliveMsRaw : 60_000
  const lingerMsRaw = Number(process.env.VOBASE_REALTIME_LISTEN_LINGER_MS ?? 60_000)
  const lingerMs = Number.isFinite(lingerMsRaw) && lingerMsRaw >= 0 ? lingerMsRaw : 60_000
  // Escape hatch: pre-0.44 behavior — LISTEN held for the process lifetime. Pins a Neon compute at its CU floor 24/7, so it's only for self-hosted Postgres deployments that would rather not pay a reconnect on the first subscriber.
  const eagerListen = process.env.VOBASE_REALTIME_EAGER_LISTEN === '1'

  const listener = createScopedListener({
    lingerMs,
    // Eager mode pins refs=1 at boot with no real subscriber, so a permanently bad DSN would retry forever and re-wake the compute every retryMaxMs. Cap it there; the subscriber-driven path retries unbounded so a real dashboard survives a long outage.
    retryMaxAttempts: eagerListen ? 10 : 0,
    onError: (err) => logger.warn({ err }, '[realtime] LISTEN lifecycle error'),
    async open() {
      const conn = postgres(dsn, {
        max: 1,
        idle_timeout: 0,
        connect_timeout: 30,
      })

      // postgres.js auto-re-issues LISTEN on reconnect; `onlisten` fires on the initial subscribe AND every re-subscribe after a connection drop. Both paths broadcast a resync: NOTIFYs emitted while no socket was listening were dropped, so subscribers must refetch.
      let listenCount = 0
      try {
        await conn.listen(
          CHANNEL,
          (payload) => {
            dispatch(payload)
          },
          () => {
            listenCount++
            if (listenCount > 1) {
              logger.info({ channel: CHANNEL, listenCount }, '[realtime] LISTEN re-established')
              dispatch(RESYNC_PAYLOAD)
            }
          },
        )
      } catch (err) {
        // End the client on a failed initial LISTEN — its internal listen sub-client retries forever otherwise. Retry is the lifecycle's job.
        await conn.end().catch(() => {})
        throw err
      }

      // Keepalive: a periodic `SELECT 1` on this client keeps the Neon compute warm while subscribers exist, so it can't autosuspend mid-session and kill the LISTEN sub-client's socket out from under us (each such kill is a delivery gap, papered over only by the reconnect resync below). It runs only while the listener is open, so an idle process still lets the compute sleep. Note this pings the query pool, not the dedicated socket postgres.js opens for `.listen()`; it defends against compute-level autosuspend, not a per-socket idle reaper sitting in front of a self-hosted Postgres.
      let keepaliveTimer: ReturnType<typeof setInterval> | null = null
      if (keepaliveMs > 0) {
        keepaliveTimer = setInterval(() => {
          conn`SELECT 1`.catch((err: unknown) => {
            logger.warn({ err }, '[realtime] keepalive ping failed')
          })
        }, keepaliveMs)
        keepaliveTimer.unref?.()
      }

      // Uniform resync on every successful open (first open of an epoch included): any open that follows a failed attempt or a torn-down epoch may sit past a delivery gap, and one redundant invalidate-all per dashboard-open is cheap.
      dispatch(RESYNC_PAYLOAD)

      return {
        close: async () => {
          if (keepaliveTimer) clearInterval(keepaliveTimer)
          await conn.end()
        },
      }
    },
  })

  if (eagerListen) {
    listener.retain()
    await listener.ready()
  }

  return buildRealtimeService(db, subscribers, () => listener.shutdown(), listener)
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
  return buildRealtimeService(db, subscribers, unsub)
}

/** No-op fallback when LISTEN/NOTIFY initialization fails at boot. */
export function createNoopRealtime(): RealtimeService {
  return {
    subscribe() {
      return () => {}
    },
    async notify() {},
    async ready() {},
    async shutdown() {},
  }
}
