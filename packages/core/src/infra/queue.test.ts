import { describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';

import { createScheduler } from './queue';

describe('createScheduler()', () => {
  it('enqueues a job via scheduler.add()', async () => {
    const pglite = new PGlite();
    const scheduler = await createScheduler({ connection: pglite });

    await scheduler.add('email.send', { to: 'user@example.com' });

    const result = await pglite.query<{ name: string }>(
      "SELECT name FROM pgboss.job WHERE name = 'email.send' LIMIT 1",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('email.send');
  });

  it('send() returns a job ID string', async () => {
    const pglite = new PGlite();
    const scheduler = await createScheduler({ connection: pglite });

    const id = await scheduler.send('invoice.generate', { number: 'INV-001' });

    expect(typeof id).toBe('string');
    expect(id).toBeTruthy();
  });

  it('send() with retryLimit stores job with correct name', async () => {
    const pglite = new PGlite();
    const scheduler = await createScheduler({ connection: pglite });

    await scheduler.add(
      'report.build',
      { period: 'weekly' },
      { retryLimit: 3 },
    );

    const result = await pglite.query<{ name: string }>(
      "SELECT name FROM pgboss.job WHERE name = 'report.build' LIMIT 1",
    );
    expect(result.rows).toHaveLength(1);
  });
});
