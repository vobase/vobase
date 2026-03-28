import { afterEach, describe, expect, it } from 'bun:test';

import { createTestPGlite } from '../test-helpers';
import { createWorker, defineJob, jobRegistry } from './job';
import { createScheduler } from './queue';

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
  // pg-boss requires exclusive PGlite access; flaky under parallel test load
  // (electric-sql/pglite#324). Skipped in CI — covered by template integration tests.
  (process.env.CI ? it.skip : it)('processes an enqueued job end-to-end', async () => {
    const pglite = await createTestPGlite();
    const scheduler = await createScheduler({ connection: pglite });

    let processedData: unknown;
    let resolveProcessed!: () => void;
    const processed = new Promise<void>((resolve) => {
      resolveProcessed = resolve;
    });

    const job = defineJob('invoice.sync', async (data) => {
      processedData = data;
      resolveProcessed();
    });

    const worker = await createWorker([job], { connection: pglite });

    try {
      await scheduler.add('invoice.sync', { id: 'inv_1' });

      await Promise.race([
        processed,
        Bun.sleep(10_000).then(() => {
          throw new Error('Timed out waiting for invoice.sync to be processed');
        }),
      ]);

      expect(processedData).toEqual({ id: 'inv_1' });
    } finally {
      await worker.close();
    }
  });
});
