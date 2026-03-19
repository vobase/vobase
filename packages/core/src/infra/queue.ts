import type { PGlite } from '@electric-sql/pglite';
import PgBoss from 'pg-boss';

export interface JobOptions {
  singletonKey?: string;
  retryBackoff?: boolean;
  deadLetter?: string;
  expireInSeconds?: number;
  startAfter?: number | string | Date;
  retryLimit?: number;
  retryDelay?: number;
  priority?: number;
}

export interface SchedulerOptions {
  /** Postgres connection string, PGlite instance, or local path for embedded PGlite */
  connection?: PGlite | string;
  /** @deprecated Use connection */
  dbPath?: string;
}

export interface Scheduler {
  /** Enqueue a job. Fire-and-forget; does not return the job ID. */
  add(name: string, data: unknown, options?: JobOptions): Promise<void>;
  /** Enqueue a job and return the pg-boss job ID (or null if deduplicated). */
  send(
    name: string,
    data: unknown,
    options?: JobOptions,
  ): Promise<string | null>;
}

// Cache PGlite instances by path so scheduler and worker share state within a process
const pgliteCache = new Map<string, PGlite>();

export async function getOrCreatePglite(path: string): Promise<PGlite> {
  if (!pgliteCache.has(path)) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { vector } = await import('@electric-sql/pglite/vector');
    const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
    pgliteCache.set(
      path,
      new PGlite(path, { extensions: { vector, pgcrypto } }),
    );
  }
  return pgliteCache.get(path) as PGlite;
}

export function buildPgliteAdapter(pglite: PGlite) {
  return {
    async executeSql(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: unknown[] }> {
      if (values && values.length > 0) {
        // Extended protocol — single statement with params
        const result = await pglite.query(text, values as unknown[]);
        return { rows: result.rows };
      }
      // Simple protocol — supports multi-statement DDL used by pg-boss migrations
      const results = await pglite.exec(text);
      const last = results[results.length - 1];
      return { rows: last?.rows ?? [] };
    },
  };
}

async function buildBoss(connection: PGlite | string): Promise<PgBoss> {
  if (typeof connection !== 'string') {
    return new PgBoss({ db: buildPgliteAdapter(connection) });
  }
  if (
    connection.startsWith('postgres://') ||
    connection.startsWith('postgresql://')
  ) {
    return new PgBoss(connection);
  }
  // Local path — use cached PGlite so scheduler and worker in the same process share state
  const pglite = await getOrCreatePglite(connection);
  return new PgBoss({ db: buildPgliteAdapter(pglite) });
}

export async function createScheduler(
  options?: SchedulerOptions,
): Promise<Scheduler> {
  const connection = options?.connection ?? options?.dbPath ?? 'memory://';
  const boss = await buildBoss(connection as PGlite | string);

  boss.on('error', (err) => {
    console.error('[pg-boss]', err);
  });

  await boss.start();

  const createdQueues = new Set<string>();

  async function ensureQueue(name: string): Promise<void> {
    if (!createdQueues.has(name)) {
      await boss.createQueue(name);
      createdQueues.add(name);
    }
  }

  async function send(
    name: string,
    data: unknown,
    opts?: JobOptions,
  ): Promise<string | null> {
    await ensureQueue(name);
    const sendOpts: PgBoss.SendOptions = {};
    if (opts?.singletonKey !== undefined)
      sendOpts.singletonKey = opts.singletonKey;
    if (opts?.retryBackoff !== undefined)
      sendOpts.retryBackoff = opts.retryBackoff;
    if (opts?.deadLetter !== undefined) sendOpts.deadLetter = opts.deadLetter;
    if (opts?.expireInSeconds !== undefined)
      sendOpts.expireInSeconds = opts.expireInSeconds;
    if (opts?.startAfter !== undefined)
      sendOpts.startAfter = opts.startAfter as string | Date | number;
    if (opts?.retryLimit !== undefined) sendOpts.retryLimit = opts.retryLimit;
    if (opts?.retryDelay !== undefined) sendOpts.retryDelay = opts.retryDelay;
    if (opts?.priority !== undefined) sendOpts.priority = opts.priority;
    return boss.send(name, data as object, sendOpts);
  }

  return {
    async add(name: string, data: unknown, opts?: JobOptions): Promise<void> {
      await send(name, data, opts);
    },
    send,
  };
}
