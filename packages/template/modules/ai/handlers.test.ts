import { beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { errorHandler } from '@vobase/core';
import { Hono } from 'hono';

import { eq } from 'drizzle-orm';

import { createTestDb } from '../../lib/test-helpers';
import { aiRoutes } from './handlers';
import { setModuleDeps } from './lib/deps';
import {
  channelInstances,
  channelRoutings,
  contacts,
  conversations,
} from './schema';

const BASE = 'http://localhost/api/ai';

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
  app.route('/api/ai', aiRoutes);
  return app;
}

let _pglite: PGlite;
let db: VobaseDb;

const mockRealtime = { notify: async () => {} } as never;

beforeEach(async () => {
  const result = await createTestDb();
  _pglite = result.pglite as unknown as PGlite;
  db = result.db;

  // Seed a web channel instance for tests
  await db.insert(channelInstances).values({
    id: 'ci-web-test',
    type: 'web',
    label: 'Web Chat',
    source: 'env',
    status: 'active',
  });

  // Initialize module deps so getModuleDeps() works in PATCH/POST handlers
  setModuleDeps({
    db,
    scheduler: {} as never,
    channels: {} as never,
    realtime: mockRealtime,
  });
});

// Singleton PGlite — never close; process exit handles cleanup

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

// ─── Shared seed helper ──────────────────────────────────────────────

async function seedConversationFixtures(db: VobaseDb) {
  await db.insert(contacts).values({
    id: 'contact-tab',
    phone: '+6591110001',
    name: 'Tab Customer',
    role: 'customer',
  });

  await db.insert(channelRoutings).values({
    id: 'ep-tab',
    name: 'Tab Routing',
    channelInstanceId: 'ci-web-test',
    agentId: 'booking',
  });
}

describe('helpdesk tab endpoints', () => {
  it('GET /conversations/attention returns active human/supervised/held conversations', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    await db.insert(conversations).values([
      {
        id: 'conv-human',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-tab',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'active',
        mode: 'human',
      },
      {
        id: 'conv-ai',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-tab',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'active',
        mode: 'ai',
      },
    ]);

    const res = await app.request(`${BASE}/conversations/attention`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].id).toBe('conv-human');
  });

  it('GET /conversations/attention includes hasPendingEscalation ai-mode conversations', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    await db.insert(conversations).values({
      id: 'conv-escalated-ai',
      channelRoutingId: 'ep-tab',
      contactId: 'contact-tab',
      agentId: 'booking',
      channelInstanceId: 'ci-web-test',
      status: 'active',
      mode: 'ai',
      hasPendingEscalation: true,
    });

    const res = await app.request(`${BASE}/conversations/attention`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].id).toBe('conv-escalated-ai');
  });

  it('GET /conversations/ai-active returns active ai-mode conversations only', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    await db.insert(conversations).values([
      {
        id: 'conv-ai-1',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-tab',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'active',
        mode: 'ai',
      },
      {
        id: 'conv-human-1',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-tab',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'active',
        mode: 'human',
      },
    ]);

    const res = await app.request(`${BASE}/conversations/ai-active`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].id).toBe('conv-ai-1');
  });

  it('GET /conversations/resolved returns completed and failed conversations', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    await db.insert(conversations).values([
      {
        id: 'conv-done',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-tab',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'completed',
      },
      {
        id: 'conv-failed',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-tab',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'failed',
      },
      {
        id: 'conv-active',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-tab',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'active',
      },
    ]);

    const res = await app.request(`${BASE}/conversations/resolved`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(2);
    const ids = body.map((r: { id: string }) => r.id).sort();
    expect(ids).toEqual(['conv-done', 'conv-failed'].sort());
  });

  it('GET /conversations/counts returns accurate tab counts', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    await db.insert(conversations).values([
      {
        id: 'cnt-human',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-tab',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'active',
        mode: 'human',
      },
      {
        id: 'cnt-ai',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-tab',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'active',
        mode: 'ai',
      },
      {
        id: 'cnt-done',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-tab',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'completed',
      },
    ]);

    const res = await app.request(`${BASE}/conversations/counts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attention).toBe(1);
    expect(body.ai).toBe(1);
    expect(body.done).toBe(1);
  });

  it('route ordering: /conversations/attention is not matched as /:id', async () => {
    const app = createApp(db);

    // If /attention were matched as /:id, the handler would try to look up
    // a conversation with id='attention' and return 404. A correct route
    // ordering returns 200 with an array instead.
    const res = await app.request(`${BASE}/conversations/attention`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('waitingSince lifecycle', () => {
  beforeEach(async () => {
    await seedConversationFixtures(db);
    await db.insert(conversations).values({
      id: 'conv-ws',
      channelRoutingId: 'ep-tab',
      contactId: 'contact-tab',
      agentId: 'booking',
      channelInstanceId: 'ci-web-test',
      status: 'active',
      mode: 'ai',
    });
  });

  it('PATCH ai→human sets waitingSince', async () => {
    const app = createApp(db);

    const res = await app.request(`${BASE}/conversations/conv-ws`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'human' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('human');
    expect(body.waitingSince).not.toBeNull();
  });

  it('PATCH human→supervised preserves waitingSince', async () => {
    const app = createApp(db);

    // Set up a human-mode conversation with waitingSince already set
    await db.insert(conversations).values({
      id: 'conv-ws-human',
      channelRoutingId: 'ep-tab',
      contactId: 'contact-tab',
      agentId: 'booking',
      channelInstanceId: 'ci-web-test',
      status: 'active',
      mode: 'human',
      waitingSince: new Date('2024-01-01T00:00:00Z'),
    });

    const res = await app.request(`${BASE}/conversations/conv-ws-human`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'supervised' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('supervised');
    // waitingSince should be preserved (not reset or cleared)
    expect(body.waitingSince).not.toBeNull();
  });

  it('POST /handback clears waitingSince and hasPendingEscalation', async () => {
    const app = createApp(db);

    await db.insert(conversations).values({
      id: 'conv-ws-hb',
      channelRoutingId: 'ep-tab',
      contactId: 'contact-tab',
      agentId: 'booking',
      channelInstanceId: 'ci-web-test',
      status: 'active',
      mode: 'human',
      waitingSince: new Date(),
      hasPendingEscalation: true,
    });

    const res = await app.request(`${BASE}/conversations/conv-ws-hb/handback`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify DB state directly — handback returns { success, mode } not the full record
    const [conv] = await db
      .select({
        mode: conversations.mode,
        waitingSince: conversations.waitingSince,
        hasPendingEscalation: conversations.hasPendingEscalation,
      })
      .from(conversations)
      .where(eq(conversations.id, 'conv-ws-hb'));
    expect(conv.mode).toBe('ai');
    expect(conv.waitingSince == null).toBe(true);
    expect(conv.hasPendingEscalation).toBe(false);
  });
});

describe('unreadCount', () => {
  it('POST /conversations/:id/read resets unreadCount to 0', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    await db.insert(conversations).values({
      id: 'conv-unread',
      channelRoutingId: 'ep-tab',
      contactId: 'contact-tab',
      agentId: 'booking',
      channelInstanceId: 'ci-web-test',
      status: 'active',
      mode: 'human',
      unreadCount: 5,
    });

    const res = await app.request(`${BASE}/conversations/conv-unread/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastReadMessageId: 'msg-last' }),
    });

    expect(res.status).toBe(200);

    const [conv] = await db
      .select({ unreadCount: conversations.unreadCount })
      .from(conversations)
      .where(eq(conversations.id, 'conv-unread'));
    expect(conv.unreadCount).toBe(0);
  });
});
