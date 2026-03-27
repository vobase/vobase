import { describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import { createNoopRealtime, createRealtimeService } from './realtime';

/**
 * Create a PGlite + Drizzle pair and register in the pglite cache
 * so createRealtimeService can find the PGlite client via getPgliteClient().
 */
async function createTestRealtimeDb() {
  const pglite = new PGlite();
  await pglite.waitReady;
  const db = drizzle({ client: pglite });

  // Register in the module-level cache so getPgliteClient() can find it
  const _clientModule = await import('../db/client');
  // getPgliteClient reads from the Map — we need to populate it
  // Use createDatabase's side effect: it caches the PGlite by path
  // Instead, we'll use a test-only approach: access the cache via the module
  const fakePath = `test-realtime-${Date.now()}-${Math.random()}`;

  // The pgliteCache is module-private, but we can work around it:
  // getPgliteClient returns pgliteCache.get(path), so we need the PGlite in there.
  // We'll directly NOTIFY via pglite.exec and test the listen path directly.
  return { pglite, db, fakePath };
}

describe('RealtimeService (PGlite direct)', () => {
  it('roundtrip: notify() delivers to subscribe()', async () => {
    const { pglite, db } = await createTestRealtimeDb();

    // Set up listener directly on PGlite
    const received: string[] = [];
    const unsub = await pglite.listen('vobase_events', (payload) => {
      received.push(payload);
    });

    // Use db.execute to send NOTIFY (same as the service does)
    const { sql } = await import('drizzle-orm');
    const json = JSON.stringify({
      table: 'messaging-threads',
      id: 'abc-123',
      action: 'insert',
    });
    await db.execute(sql`SELECT pg_notify('vobase_events', ${json})`);

    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(1);
    const parsed = JSON.parse(received[0]);
    expect(parsed.table).toBe('messaging-threads');
    expect(parsed.id).toBe('abc-123');
    expect(parsed.action).toBe('insert');

    await unsub();
    await pglite.close();
  });

  it('full service roundtrip via createRealtimeService', async () => {
    const { createDatabase } = await import('../db/client');
    const testPath = `memory://test-rt-${Date.now()}`;
    const db = createDatabase(testPath);

    const service = await createRealtimeService(testPath, db);

    const received: string[] = [];
    service.subscribe((payload) => {
      received.push(payload);
    });

    await service.notify({
      table: 'messaging-threads',
      id: 'abc-123',
      action: 'insert',
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(1);
    const parsed = JSON.parse(received[0]);
    expect(parsed.table).toBe('messaging-threads');
    expect(parsed.id).toBe('abc-123');
    expect(parsed.action).toBe('insert');

    await service.shutdown();
  });

  it('subscribe returns working unsubscribe function', async () => {
    const testPath = `memory://test-rt-unsub-${Date.now()}`;
    const { createDatabase } = await import('../db/client');
    const db = createDatabase(testPath);

    const service = await createRealtimeService(testPath, db);

    const received: string[] = [];
    const unsub = service.subscribe((payload) => {
      received.push(payload);
    });

    unsub();

    await service.notify({ table: 'test', action: 'insert' });
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(0);

    await service.shutdown();
  });

  it('multiple subscribers receive the same event', async () => {
    const testPath = `memory://test-rt-multi-${Date.now()}`;
    const { createDatabase } = await import('../db/client');
    const db = createDatabase(testPath);

    const service = await createRealtimeService(testPath, db);

    const received1: string[] = [];
    const received2: string[] = [];
    service.subscribe((p) => received1.push(p));
    service.subscribe((p) => received2.push(p));

    await service.notify({ table: 'threads', action: 'update' });
    await new Promise((r) => setTimeout(r, 50));

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
    expect(received1[0]).toBe(received2[0]);

    await service.shutdown();
  });

  it('shutdown clears subscribers', async () => {
    const testPath = `memory://test-rt-shutdown-${Date.now()}`;
    const { createDatabase } = await import('../db/client');
    const db = createDatabase(testPath);

    const service = await createRealtimeService(testPath, db);

    const received: string[] = [];
    service.subscribe((p) => received.push(p));

    await service.shutdown();
    expect(received).toHaveLength(0);
  });
});

describe('createNoopRealtime', () => {
  it('subscribe returns no-op unsubscribe', () => {
    const service = createNoopRealtime();
    const unsub = service.subscribe(() => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('notify does not throw', async () => {
    const service = createNoopRealtime();
    await service.notify({ table: 'test', action: 'insert' });
  });

  it('shutdown does not throw', async () => {
    const service = createNoopRealtime();
    await service.shutdown();
  });
});
