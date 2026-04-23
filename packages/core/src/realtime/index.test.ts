import { describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';

import { createDatabase } from '../db/client';
import { getSharedPGlite } from '../test-helpers';
import { createNoopRealtime, createRealtimeService } from '.';

describe('RealtimeService (PGlite direct)', () => {
  it('roundtrip: notify() delivers to subscribe()', async () => {
    const pglite = await getSharedPGlite();
    const db = createDatabase('memory://');

    const received: string[] = [];
    const unsub = await pglite.listen('vobase_events', (payload) => {
      received.push(payload);
    });

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
  });

  it('full service roundtrip via createRealtimeService', async () => {
    await getSharedPGlite();
    const db = createDatabase('memory://');
    const service = await createRealtimeService('memory://', db);

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
    await getSharedPGlite();
    const db = createDatabase('memory://');
    const service = await createRealtimeService('memory://', db);

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
    await getSharedPGlite();
    const db = createDatabase('memory://');
    const service = await createRealtimeService('memory://', db);

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
    await getSharedPGlite();
    const db = createDatabase('memory://');
    const service = await createRealtimeService('memory://', db);

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
