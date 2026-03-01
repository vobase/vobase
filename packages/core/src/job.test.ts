import { rmSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { shutdownManager } from 'bunqueue/client';

import { createWorker, defineJob, jobRegistry } from './job';
import { createScheduler } from './queue';

const TEST_DB_PATH = `/tmp/vobase-bunqueue-${process.pid}.db`;
const globalScope = globalThis as typeof globalThis & {
  __vobaseBunqueueTestRefs__?: number;
};

function makeQueueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

beforeAll(() => {
  globalScope.__vobaseBunqueueTestRefs__ =
    (globalScope.__vobaseBunqueueTestRefs__ ?? 0) + 1;
});

afterAll(() => {
  const refs = (globalScope.__vobaseBunqueueTestRefs__ ?? 1) - 1;
  globalScope.__vobaseBunqueueTestRefs__ = refs;

  if (refs === 0) {
    shutdownManager();
    rmSync(TEST_DB_PATH, { force: true });
    rmSync(`${TEST_DB_PATH}-shm`, { force: true });
    rmSync(`${TEST_DB_PATH}-wal`, { force: true });
  }
});

afterEach(() => {
  jobRegistry.clear();
});

describe('defineJob()', () => {
  it('registers a job definition in the module registry', async () => {
    const handler = async (): Promise<void> => {
      await Bun.sleep(0);
    };

    const definition = defineJob('report.generate', handler);

    expect(definition.name).toBe('report.generate');
    expect(definition.handler).toBe(handler);
    expect(jobRegistry.get('report.generate')).toBe(handler);
  });
});

describe('createWorker()', () => {
  it('processes an enqueued job end-to-end', async () => {
    const queueName = makeQueueName('worker-roundtrip');
    const scheduler = createScheduler({ dbPath: TEST_DB_PATH, queueName });

    let processedData: unknown;
    let resolveProcessed!: () => void;
    const processed = new Promise<void>((resolve) => {
      resolveProcessed = resolve;
    });

    const job = defineJob('invoice.sync', async (data) => {
      processedData = data;
      resolveProcessed();
    });

    const worker = createWorker([job], { dbPath: TEST_DB_PATH, queueName });

    try {
      await scheduler.add('invoice.sync', { id: 'inv_1' });

      await Promise.race([
        processed,
        Bun.sleep(1_500).then(() => {
          throw new Error('Timed out waiting for invoice.sync to be processed');
        }),
      ]);

      expect(processedData).toEqual({ id: 'inv_1' });
    } finally {
      await worker.close();
    }
  });
});
