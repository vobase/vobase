import { Worker, type Job, type WorkerOptions as BunqueueWorkerOptions } from 'bunqueue/client';

import { validation } from './errors';
import {
  DEFAULT_QUEUE_DB_PATH,
  DEFAULT_QUEUE_NAME,
  configureQueueDataPath,
  type SchedulerOptions,
} from './queue';

export type JobHandler = (data: unknown) => Promise<void>;

export interface JobDefinition {
  name: string;
  handler: JobHandler;
}

export interface WorkerOptions extends Pick<SchedulerOptions, 'dbPath' | 'queueName'> {
  concurrency?: number;
}

export const jobRegistry = new Map<string, JobHandler>();

function assertJobName(name: string): void {
  if (!name.trim()) {
    throw validation({ name }, 'Job name must be a non-empty string');
  }
}

function assertConcurrency(concurrency: number): void {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw validation({ concurrency }, 'Worker concurrency must be a positive integer');
  }
}

function registerJob(definition: JobDefinition): void {
  assertJobName(definition.name);
  jobRegistry.set(definition.name, definition.handler);
}

async function processJob(job: Job<unknown>): Promise<void> {
  const handler = jobRegistry.get(job.name);
  if (!handler) {
    throw validation({ jobName: job.name }, `No registered handler for job "${job.name}"`);
  }

  await handler(job.data);
}

export function defineJob(name: string, handler: JobHandler): JobDefinition {
  assertJobName(name);

  const definition = { name, handler };
  registerJob(definition);
  return definition;
}

export function createWorker(jobs: JobDefinition[], options?: WorkerOptions): Worker {
  for (const job of jobs) {
    registerJob(job);
  }

  const concurrency = options?.concurrency ?? 5;
  assertConcurrency(concurrency);

  configureQueueDataPath(options?.dbPath ?? DEFAULT_QUEUE_DB_PATH);

  const workerOptions: BunqueueWorkerOptions = {
    embedded: true,
    concurrency,
  };

  return new Worker(options?.queueName ?? DEFAULT_QUEUE_NAME, processJob, workerOptions);
}
