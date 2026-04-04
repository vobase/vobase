import type { PGlite } from '@electric-sql/pglite';
import { PgBoss } from 'pg-boss';

import { getPgliteClient } from '../db/client';
import { validation } from './errors';
import { buildPgliteAdapter, type SchedulerOptions } from './queue';

export type JobHandler = (data: unknown) => Promise<void>;

export interface JobDefinition {
  name: string;
  handler: JobHandler;
}

export interface WorkerOptions
  extends Pick<SchedulerOptions, 'connection' | 'dbPath'> {
  concurrency?: number;
}

export const jobRegistry = new Map<string, JobHandler>();

/** pg-boss 12+ only allows [\w.\-/]+ in queue names — normalize colons to slashes */
function toQueueName(name: string): string {
  return name.replace(/:/g, '/');
}

function assertJobName(name: string): void {
  if (!name.trim()) {
    throw validation({ name }, 'Job name must be a non-empty string');
  }
}

export function defineJob(name: string, handler: JobHandler): JobDefinition {
  assertJobName(name);
  const definition = { name, handler };
  jobRegistry.set(name, handler);
  return definition;
}

export async function createWorker(
  jobs: JobDefinition[],
  options?: WorkerOptions,
): Promise<{ close: () => Promise<void> }> {
  for (const job of jobs) {
    assertJobName(job.name);
    jobRegistry.set(job.name, job.handler);
  }

  const concurrency = options?.concurrency ?? 5;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw validation(
      { concurrency },
      'Worker concurrency must be a positive integer',
    );
  }

  const connection = options?.connection ?? options?.dbPath ?? 'memory://';

  let boss: PgBoss;
  if (typeof connection !== 'string') {
    // PGlite instance (tests)
    boss = new PgBoss({ db: buildPgliteAdapter(connection as PGlite) });
  } else if (
    !connection.startsWith('postgres://') &&
    !connection.startsWith('postgresql://')
  ) {
    // Non-Postgres string (e.g. 'memory://') — resolve to cached PGlite instance
    const pglite = getPgliteClient(connection);
    if (pglite) {
      boss = new PgBoss({ db: buildPgliteAdapter(pglite) });
    } else {
      boss = new PgBoss(connection);
    }
  } else {
    // Postgres connection string
    boss = new PgBoss(connection);
  }

  boss.on('error', (err: Error) => {
    console.error('[pg-boss worker]', err);
  });

  try {
    await boss.start();
  } catch (err) {
    console.error('[pg-boss worker] Failed to start — job workers will be disabled:', err);
    return { close: async () => {} };
  }

  for (const job of jobs) {
    const queueName = toQueueName(job.name);
    await boss.createQueue(queueName);
    await boss.work(
      queueName,
      { batchSize: concurrency },
      async (pgJobs: { data: unknown }[]) => {
        await Promise.all(
          pgJobs.map((pgJob: { data: unknown }) => job.handler(pgJob.data)),
        );
      },
    );
  }

  return { close: () => boss.stop() };
}
