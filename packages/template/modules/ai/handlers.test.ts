import { beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { errorHandler } from '@vobase/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

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

    // Seed contact + endpoint + active conversation bound to ci-web-test
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
      assignee: 'agent:booking',
      status: 'active',
    });

    const res = await app.request(`${BASE}/instances/ci-web-test`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(409);
  });

  it('DELETE /instances/:id succeeds when sessions are resolved (not active)', async () => {
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
      assignee: 'agent:booking',
      status: 'resolved',
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
  it('GET /conversations/active returns contacts with active non-held conversations', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    // Two contacts: one with active (agent assignee), one with resolved
    await db.insert(contacts).values([
      { id: 'contact-active', phone: '+6511111111', role: 'customer' },
      { id: 'contact-done', phone: '+6522222222', role: 'customer' },
    ]);
    await db.insert(conversations).values([
      {
        id: 'conv-active',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-active',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        assignee: 'agent:booking',
        status: 'active',
        onHold: false,
      },
      {
        id: 'conv-done',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-done',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        assignee: 'agent:booking',
        status: 'resolved',
      },
    ]);

    const res = await app.request(`${BASE}/conversations/active`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Returns active (non-held) contacts
    expect(body.length).toBe(1);
    expect(body[0].id).toBe('contact-active');
  });

  it('GET /conversations/on-hold returns contacts with on-hold conversations', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    await db.insert(contacts).values([
      { id: 'contact-held', phone: '+6533333333', role: 'customer' },
      { id: 'contact-active2', phone: '+6544444444', role: 'customer' },
    ]);
    await db.insert(conversations).values([
      {
        id: 'conv-held',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-held',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        assignee: 'agent:booking',
        status: 'active',
        onHold: true,
      },
      {
        id: 'conv-active2',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-active2',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        assignee: 'agent:booking',
        status: 'active',
        onHold: false,
      },
    ]);

    const res = await app.request(`${BASE}/conversations/on-hold`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].id).toBe('contact-held');
  });

  it('GET /conversations/resolved returns contacts where all conversations are terminal', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    // Use separate channel instances to avoid unique constraint (contact_id, channel_instance_id)
    await db.insert(channelInstances).values([
      { id: 'ci-done-1', type: 'web', label: 'Done 1', source: 'env', status: 'active' },
      { id: 'ci-mixed-1', type: 'web', label: 'Mixed 1', source: 'env', status: 'active' },
    ]);

    // Contact with only resolved conversations
    await db.insert(contacts).values([
      { id: 'contact-done2', phone: '+6566666666', role: 'customer' },
      { id: 'contact-mixed', phone: '+6577777777', role: 'customer' },
    ]);
    await db.insert(conversations).values([
      {
        id: 'conv-done2',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-done2',
        agentId: 'booking',
        channelInstanceId: 'ci-done-1',
        assignee: 'agent:booking',
        status: 'resolved',
      },
      // Mixed contact: has active — should NOT be in done
      {
        id: 'conv-mixed-active',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-mixed',
        agentId: 'booking',
        channelInstanceId: 'ci-mixed-1',
        assignee: 'agent:booking',
        status: 'active',
      },
    ]);

    const res = await app.request(`${BASE}/conversations/resolved`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Only contact-done2 (all terminal), not contact-mixed (has active)
    expect(body.length).toBe(1);
    expect(body[0].id).toBe('contact-done2');
  });

  it('GET /conversations/counts returns accurate contact-level tab counts', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    await db.insert(contacts).values([
      { id: 'cnt-c1', phone: '+6588881111', role: 'customer' },
      { id: 'cnt-c2', phone: '+6588882222', role: 'customer' },
      { id: 'cnt-c3', phone: '+6588883333', role: 'customer' },
    ]);
    await db.insert(conversations).values([
      {
        id: 'cnt-active',
        channelRoutingId: 'ep-tab',
        contactId: 'cnt-c1',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        assignee: 'agent:booking',
        status: 'active',
        onHold: false,
      },
      {
        id: 'cnt-held',
        channelRoutingId: 'ep-tab',
        contactId: 'cnt-c2',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        assignee: 'agent:booking',
        status: 'active',
        onHold: true,
      },
      {
        id: 'cnt-done',
        channelRoutingId: 'ep-tab',
        contactId: 'cnt-c3',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        assignee: 'agent:booking',
        status: 'resolved',
      },
    ]);

    const res = await app.request(`${BASE}/conversations/counts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(1);
    expect(body.onHold).toBe(1);
    expect(body.done).toBe(1);
  });

  it('route ordering: /conversations/active is not matched as /:id', async () => {
    const app = createApp(db);

    // If /active were matched as /:id, the handler would try to look up
    // a conversation with id='active' and return 404. A correct route
    // ordering returns 200 with an array instead.
    const res = await app.request(`${BASE}/conversations/active`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('conversation PATCH (assignee/onHold)', () => {
  beforeEach(async () => {
    await seedConversationFixtures(db);
    await db.insert(conversations).values({
      id: 'conv-ws',
      channelRoutingId: 'ep-tab',
      contactId: 'contact-tab',
      agentId: 'booking',
      channelInstanceId: 'ci-web-test',
      assignee: 'agent:booking',
      status: 'active',
      onHold: false,
    });
  });

  it('PATCH assignee reassigns conversation', async () => {
    const app = createApp(db);

    const res = await app.request(`${BASE}/conversations/conv-ws`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee: 'user-1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assignee).toBe('user-1');
  });

  it('PATCH onHold=true puts conversation on hold', async () => {
    const app = createApp(db);

    const res = await app.request(`${BASE}/conversations/conv-ws`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onHold: true }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onHold).toBe(true);
  });

  it('PATCH onHold=false removes hold', async () => {
    const app = createApp(db);

    // Use a separate contact to avoid unique constraint with conv-ws (contact-tab + ci-web-test)
    await db.insert(contacts).values({
      id: 'contact-tab-held',
      phone: '+6591110099',
      name: 'Held Customer',
      role: 'customer',
    });
    await db.insert(conversations).values({
      id: 'conv-ws-held',
      channelRoutingId: 'ep-tab',
      contactId: 'contact-tab-held',
      agentId: 'booking',
      channelInstanceId: 'ci-web-test',
      assignee: 'agent:booking',
      status: 'active',
      onHold: true,
    });

    const res = await app.request(`${BASE}/conversations/conv-ws-held`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onHold: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.onHold).toBe(false);
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
      assignee: 'user-1',
      status: 'active',
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
