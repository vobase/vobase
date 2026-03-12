import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Queue, shutdownManager } from 'bunqueue/client';

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

describe('createScheduler()', () => {
  it('enqueues a job via scheduler.add()', async () => {
    const queueName = makeQueueName('scheduler-add');
    const scheduler = createScheduler({ dbPath: TEST_DB_PATH, queueName });

    await scheduler.add('email.send', { to: 'user@example.com' });

    const queue = new Queue(queueName, { embedded: true });
    const waitingCount = await queue.getWaitingCount();
    queue.close();

    expect(waitingCount).toBe(1);
  });
});
