import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { errorHandler } from '@vobase/core';
import { Hono } from 'hono';

import { createTestDb } from '../../lib/test-helpers';
import { contacts } from '../contacts/schema';
import { conversationsRoutes } from './handlers';
import { channelInstances, channelRoutings, conversations } from './schema';

const BASE = 'http://localhost/api/conversations';

function createApp(db: VobaseDb) {
  const app = new Hono();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('user', {
      id: 'user-1',
      email: 'test@test.com',
      name: 'Test',
      role: 'user',
    });
    c.set('scheduler', {} as never);
    c.set('storage', {} as never);
    c.set('channels', {} as never);
    c.set('http', {} as never);
    await next();
  });
  app.route('/api/conversations', conversationsRoutes);
  return app;
}

let pglite: PGlite;
let db: VobaseDb;

beforeEach(async () => {
  const result = await createTestDb();
  pglite = result.pglite as unknown as PGlite;
  db = result.db;

  // Seed a web channel instance for tests
  await db.insert(channelInstances).values({
    id: 'ci-web-test',
    type: 'web',
    label: 'Web Chat',
    source: 'env',
    status: 'active',
  });
});

afterEach(async () => {
  await (pglite as unknown as { close: () => Promise<void> }).close();
});

describe('channel routing CRUD with channelInstanceId', () => {
  it('POST /endpoints creates endpoint with channelInstanceId', async () => {
    const app = createApp(db);

    const res = await app.request(`${BASE}/channel-routings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Endpoint',
        channelInstanceId: 'ci-web-test',
        agentId: 'booking',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.channelInstanceId).toBe('ci-web-test');
    expect(body.name).toBe('Test Endpoint');
    expect(body.agentId).toBe('booking');
  });

  it('GET /endpoints lists endpoints', async () => {
    const app = createApp(db);

    // Create a channel routing first
    await db.insert(channelRoutings).values({
      id: 'ep-test-1',
      name: 'Test EP',
      channelInstanceId: 'ci-web-test',
      agentId: 'booking',
    });

    const res = await app.request(`${BASE}/channel-routings`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].channelInstanceId).toBe('ci-web-test');
  });

  it('PATCH /endpoints/:id updates channelInstanceId', async () => {
    const app = createApp(db);

    // Seed another channel instance
    await db.insert(channelInstances).values({
      id: 'ci-wa-test',
      type: 'whatsapp',
      label: 'WhatsApp Test',
      source: 'env',
      status: 'active',
    });

    await db.insert(channelRoutings).values({
      id: 'ep-test-2',
      name: 'Test EP',
      channelInstanceId: 'ci-web-test',
      agentId: 'booking',
    });

    const res = await app.request(`${BASE}/channel-routings/ep-test-2`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelInstanceId: 'ci-wa-test' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channelInstanceId).toBe('ci-wa-test');
  });
});

describe('channel instance deletion protection (M8)', () => {
  it('DELETE /instances/:id succeeds when no active sessions exist', async () => {
    const app = createApp(db);

    const res = await app.request(`${BASE}/instances/ci-web-test`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('DELETE /instances/:id returns 409 when active sessions exist', async () => {
    const app = createApp(db);

    // Seed contact + endpoint + active session bound to ci-web-test
    await db.insert(contacts).values({
      id: 'contact-m8',
      phone: '+6591110000',
      name: 'M8 Customer',
      role: 'customer',
    });

    await db.insert(channelRoutings).values({
      id: 'ep-m8',
      name: 'M8 Channel Routing',
      channelInstanceId: 'ci-web-test',
      agentId: 'booking',
    });

    await db.insert(conversations).values({
      id: 'session-m8',
      channelRoutingId: 'ep-m8',
      contactId: 'contact-m8',
      agentId: 'booking',
      channelInstanceId: 'ci-web-test',
      status: 'active',
    });

    const res = await app.request(`${BASE}/instances/ci-web-test`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(409);
  });

  it('DELETE /instances/:id succeeds when sessions are completed (not active)', async () => {
    const app = createApp(db);

    // Seed a second channel instance for this test
    await db.insert(channelInstances).values({
      id: 'ci-web-m8b',
      type: 'web',
      label: 'Web Chat M8B',
      source: 'env',
      status: 'active',
    });

    await db.insert(contacts).values({
      id: 'contact-m8b',
      phone: '+6592220000',
      name: 'M8B Customer',
      role: 'customer',
    });

    await db.insert(channelRoutings).values({
      id: 'ep-m8b',
      name: 'M8B Channel Routing',
      channelInstanceId: 'ci-web-m8b',
      agentId: 'booking',
    });

    await db.insert(conversations).values({
      id: 'session-m8b',
      channelRoutingId: 'ep-m8b',
      contactId: 'contact-m8b',
      agentId: 'booking',
      channelInstanceId: 'ci-web-m8b',
      status: 'completed',
    });

    const res = await app.request(`${BASE}/instances/ci-web-m8b`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
  });
});
