import type { PGlite } from '@electric-sql/pglite';
import { PgBoss, type SendOptions } from 'pg-boss';

import { getPgliteClient } from '../db/client';

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

export interface ScheduleOptions extends JobOptions {
  /** Timezone for cron expression (default: UTC) */
  tz?: string;
  /** Unique key when multiple schedules exist on the same queue */
  key?: string;
}

export interface SchedulerOptions {
  /** Postgres connection string or PGlite instance (for tests) */
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
  /** Register a recurring cron schedule. Idempotent — safe to call on every boot. */
  schedule(
    name: string,
    cron: string,
    data?: unknown,
    options?: ScheduleOptions,
  ): Promise<void>;
  /** Remove a cron schedule. */
  unschedule(name: string, key?: string): Promise<void>;
  /** Stop the scheduler (pg-boss maintenance loop). Call during graceful shutdown. */
  stop(): Promise<void>;
}

export function buildPgliteAdapter(pglite: PGlite) {
  return {
    async executeSql(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: unknown[] }> {
      if (values && values.length > 0) {
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
    // PGlite instance (tests)
    return new PgBoss({ db: buildPgliteAdapter(connection) });
  }
  // Non-Postgres string (e.g. 'memory://') — resolve to cached PGlite instance
  if (
    !connection.startsWith('postgres://') &&
    !connection.startsWith('postgresql://')
  ) {
    const pglite = getPgliteClient(connection);
    if (pglite) return new PgBoss({ db: buildPgliteAdapter(pglite) });
  }
  // Postgres connection string
  return new PgBoss(connection);
}

export async function createScheduler(
  options?: SchedulerOptions,
): Promise<Scheduler> {
  const connection = options?.connection ?? options?.dbPath ?? 'memory://';
  const boss = await buildBoss(connection as PGlite | string);

  boss.on('error', (err: Error) => {
    console.error('[pg-boss]', err);
  });

  await boss.start();

  const createdQueues = new Set<string>();

  /** pg-boss 12+ only allows [\w.\-/]+ in queue names — normalize colons to slashes */
  function toQueueName(name: string): string {
    return name.replace(/:/g, '/');
  }

  async function ensureQueue(name: string): Promise<void> {
    const queueName = toQueueName(name);
    if (!createdQueues.has(queueName)) {
      await boss.createQueue(queueName);
      createdQueues.add(queueName);
    }
  }

  async function send(
    name: string,
    data: unknown,
    opts?: JobOptions,
  ): Promise<string | null> {
    await ensureQueue(name);
    const queueName = toQueueName(name);
    const sendOpts: SendOptions = {};
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
    return boss.send(queueName, data as object, sendOpts);
  }

  return {
    async add(name: string, data: unknown, opts?: JobOptions): Promise<void> {
      await send(name, data, opts);
    },
    send,
    async schedule(
      name: string,
      cron: string,
      data?: unknown,
      opts?: ScheduleOptions,
    ): Promise<void> {
      try {
        await ensureQueue(name);
        const queueName = toQueueName(name);
        await boss.schedule(queueName, cron, data as object, opts);
      } catch (err) {
        console.error(`[pg-boss] Failed to register schedule "${name}":`, err);
      }
    },
    async unschedule(name: string, key?: string): Promise<void> {
      const queueName = toQueueName(name);
      await boss.unschedule(queueName, key);
    },
    async stop() {
      await boss.stop();
    },
  };
}
