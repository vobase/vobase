import { afterEach, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';

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
  it('processes an enqueued job end-to-end', async () => {
    const pglite = new PGlite();
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
        Bun.sleep(5_000).then(() => {
          throw new Error('Timed out waiting for invoice.sync to be processed');
        }),
      ]);

      expect(processedData).toEqual({ id: 'inv_1' });
    } finally {
      await worker.close();
    }
  });
});
