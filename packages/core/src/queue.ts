import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Queue, shutdownManager, type JobOptions as BunqueueJobOptions } from 'bunqueue/client';

import { validation } from './errors';

export const DEFAULT_QUEUE_DB_PATH = '/data/bunqueue.db';
export const DEFAULT_QUEUE_NAME = 'vobase-jobs';

export interface JobOptions {
  delay?: number | string;
  priority?: number;
  retry?: number;
  retries?: number;
}

export interface SchedulerOptions {
  dbPath?: string;
  queueName?: string;
}

export interface Scheduler {
  add(jobName: string, data: unknown, options?: JobOptions): Promise<void>;
}

const DELAY_MULTIPLIER: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function parseDelay(delay?: number | string): number | undefined {
  if (delay === undefined) {
    return undefined;
  }

  if (typeof delay === 'number') {
    if (!Number.isFinite(delay) || delay < 0) {
      throw validation({ delay }, 'Job delay must be a non-negative number');
    }
    return Math.floor(delay);
  }

  const value = delay.trim().toLowerCase();
  if (!value) {
    throw validation({ delay }, 'Job delay string cannot be empty');
  }

  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  const match = value.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) {
    throw validation(
      { delay },
      'Invalid delay format. Use milliseconds or duration suffixes: ms, s, m, h, d'
    );
  }

  const amount = Number.parseInt(match[1], 10);
  const multiplier = DELAY_MULTIPLIER[match[2]];
  return amount * multiplier;
}

function parseAttempts(options?: JobOptions): number | undefined {
  const retryCount = options?.retries ?? options?.retry;
  if (retryCount === undefined) {
    return undefined;
  }

  if (!Number.isInteger(retryCount) || retryCount < 0) {
    throw validation({ retryCount }, 'Retry count must be a non-negative integer');
  }

  return retryCount + 1;
}

function toBunqueueJobOptions(options?: JobOptions): BunqueueJobOptions | undefined {
  if (!options) {
    return undefined;
  }

  if (options.priority !== undefined) {
    if (!Number.isInteger(options.priority) || options.priority < 0) {
      throw validation({ priority: options.priority }, 'Job priority must be a non-negative integer');
    }
  }

  const delay = parseDelay(options.delay);
  const attempts = parseAttempts(options);

  return {
    delay,
    priority: options.priority,
    attempts,
  };
}

export function configureQueueDataPath(dbPath: string): string {
  if (!dbPath.trim()) {
    throw validation({ dbPath }, 'Queue dbPath must be a non-empty string');
  }

  const existingDataPath = Bun.env.DATA_PATH;
  if (existingDataPath && existingDataPath !== dbPath) {
    shutdownManager();
  }

  mkdirSync(dirname(dbPath), { recursive: true });
  Bun.env.DATA_PATH = dbPath;
  return dbPath;
}

export function createScheduler(options?: SchedulerOptions): Scheduler {
  configureQueueDataPath(options?.dbPath ?? DEFAULT_QUEUE_DB_PATH);
  const queue = new Queue(options?.queueName ?? DEFAULT_QUEUE_NAME, { embedded: true });

  return {
    async add(jobName: string, data: unknown, options?: JobOptions): Promise<void> {
      if (!jobName.trim()) {
        throw validation({ jobName }, 'Job name must be a non-empty string');
      }

      await queue.add(jobName, data, toBunqueueJobOptions(options));
    },
  };
}
