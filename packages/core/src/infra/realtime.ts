import { type SQL, sql } from 'drizzle-orm';

import type { VobaseDb } from '../db/client';
import { getPgliteClient } from '../db/client';
import { logger } from './logger';

const CHANNEL = 'vobase_events';

export interface RealtimePayload {
  table: string;
  id?: string;
  action?: string;
  tab?: string;
  prevTab?: string;
}

/** Minimal interface satisfied by both VobaseDb and Drizzle transaction handles. */
export type RealtimeExecutor = { execute: (query: SQL) => Promise<unknown> };

export interface RealtimeService {
  /** Subscribe to invalidation events. Returns unsubscribe function. */
  subscribe(fn: (payload: string) => void): () => void;

  /** Emit a NOTIFY event. Optional tx for transactional guarantees. */
  notify(payload: RealtimePayload, tx?: RealtimeExecutor): Promise<void>;

  /** Clean up LISTEN connection and subscribers. */
  shutdown(): Promise<void>;
}

type Subscriber = (payload: string) => void;

/**
 * Create a RealtimeService backed by PostgreSQL LISTEN/NOTIFY.
 */
export async function createRealtimeService(
  databaseConfig: string,
  db: VobaseDb,
): Promise<RealtimeService> {
  const subscribers = new Set<Subscriber>();

  const dispatch = (payload: string) => {
    for (const fn of subscribers) {
      try {
        fn(payload);
      } catch {
        // subscriber errors must not crash the dispatch loop
      }
    }
  };

  // Non-Postgres string (e.g. 'memory://') — use PGlite LISTEN/NOTIFY
  if (
    !databaseConfig.startsWith('postgres://') &&
    !databaseConfig.startsWith('postgresql://')
  ) {
    const pglite = getPgliteClient(databaseConfig);
    if (pglite) {
      return createPgliteRealtime(pglite, db, subscribers, dispatch);
    }
    return createNoopRealtime();
  }

  try {
    return await createPostgresRealtime(
      databaseConfig,
      db,
      subscribers,
      dispatch,
    );
  } catch (err) {
    logger.warn(
      '[realtime] Failed to initialize — falling back to no-op service:',
      err,
    );
    return createNoopRealtime();
  }
}

async function createPostgresRealtime(
  databaseConfig: string,
  db: VobaseDb,
  subscribers: Set<Subscriber>,
  dispatch: (payload: string) => void,
): Promise<RealtimeService> {
  const postgres = (await import('postgres')).default;
  const listenConn = postgres(databaseConfig, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 10,
  });

  await listenConn.listen(CHANNEL, (payload) => {
    dispatch(payload);
  });

  return {
    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },

    async notify(payload, tx) {
      const json = JSON.stringify(payload);
      const notifyQuery = sql`SELECT pg_notify(${CHANNEL}, ${json})`;
      if (tx) {
        await tx.execute(notifyQuery);
      } else {
        await db.execute(notifyQuery);
      }
    },

    async shutdown() {
      await listenConn.end();
      subscribers.clear();
    },
  };
}

async function createPgliteRealtime(
  pglite: import('@electric-sql/pglite').PGlite,
  db: VobaseDb,
  subscribers: Set<Subscriber>,
  dispatch: (payload: string) => void,
): Promise<RealtimeService> {
  const unsub = await pglite.listen(CHANNEL, (payload) => {
    dispatch(payload);
  });

  return {
    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },

    async notify(payload, tx) {
      const json = JSON.stringify(payload);
      const notifyQuery = sql`SELECT pg_notify(${CHANNEL}, ${json})`;
      if (tx) {
        await tx.execute(notifyQuery);
      } else {
        await db.execute(notifyQuery);
      }
    },

    async shutdown() {
      unsub();
      subscribers.clear();
    },
  };
}

/** No-op fallback when LISTEN/NOTIFY initialization fails at boot. */
export function createNoopRealtime(): RealtimeService {
  return {
    subscribe() {
      return () => {};
    },
    async notify() {},
    async shutdown() {},
  };
}
