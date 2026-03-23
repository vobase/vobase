import type { PGlite } from '@electric-sql/pglite';
import { type SQL, sql } from 'drizzle-orm';

import type { VobaseDb } from '../db/client';
import { getPgliteClient } from '../db/client';
import { logger } from './logger';

const CHANNEL = 'vobase_events';

export interface RealtimePayload {
  table: string;
  id?: string;
  action?: string;
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
 * PGlite: uses native pg.listen()
 * PostgreSQL: uses a dedicated `postgres` connection for LISTEN
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

  const isPostgres =
    databaseConfig.startsWith('postgres://') ||
    databaseConfig.startsWith('postgresql://');

  try {
    if (isPostgres) {
      return await createPostgresRealtime(databaseConfig, db, subscribers, dispatch);
    }
    return await createPgliteRealtime(databaseConfig, db, subscribers, dispatch);
  } catch (err) {
    logger.warn('[realtime] Failed to initialize — falling back to no-op service:', err);
    return createNoopRealtime();
  }
}

async function createPgliteRealtime(
  databaseConfig: string,
  db: VobaseDb,
  subscribers: Set<Subscriber>,
  dispatch: (payload: string) => void,
): Promise<RealtimeService> {
  const pglite = getPgliteClient(databaseConfig);
  if (!pglite) {
    throw new Error('PGlite client not found for path: ' + databaseConfig);
  }

  const unsub = await (pglite as PGlite).listen(CHANNEL, (payload) => {
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
      await unsub();
      subscribers.clear();
    },
  };
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
