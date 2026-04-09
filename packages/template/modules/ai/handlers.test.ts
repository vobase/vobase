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
  interactions,
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

    await db.insert(interactions).values({
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

    await db.insert(interactions).values({
      id: 'session-m8b',
      channelRoutingId: 'ep-m8b',
      contactId: 'contact-m8b',
      agentId: 'booking',
      channelInstanceId: 'ci-web-m8b',
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
  it('GET /interactions/attention returns contacts with human/supervised/held interactions', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    // Create two contacts: one with human interaction (attention), one with ai-only
    await db.insert(contacts).values([
      { id: 'contact-human', phone: '+6511111111', role: 'customer' },
      { id: 'contact-ai', phone: '+6522222222', role: 'customer' },
    ]);
    await db.insert(interactions).values([
      {
        id: 'conv-human',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-human',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'active',
        mode: 'human',
      },
      {
        id: 'conv-ai',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-ai',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'active',
        mode: 'ai',
      },
    ]);

    const res = await app.request(`${BASE}/interactions/attention`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Returns one contact row (contact-human), not interaction row
    expect(body.length).toBe(1);
    expect(body[0].id).toBe('contact-human');
    expect(body[0].mode).toBe('human');
  });

  it('GET /interactions/attention includes hasPendingEscalation ai-mode interactions', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    await db.insert(contacts).values({
      id: 'contact-esc',
      phone: '+6533333333',
      role: 'customer',
    });
    await db.insert(interactions).values({
      id: 'conv-escalated-ai',
      channelRoutingId: 'ep-tab',
      contactId: 'contact-esc',
      agentId: 'booking',
      channelInstanceId: 'ci-web-test',
      status: 'active',
      mode: 'ai',
      hasPendingEscalation: true,
    });

    const res = await app.request(`${BASE}/interactions/attention`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].id).toBe('contact-esc');
    expect(body[0].hasPendingEscalation).toBe(true);
  });

  it('GET /interactions/ai-active returns contacts with active ai-only interactions', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    // Two contacts: one ai-only (active), one human (attention)
    await db.insert(contacts).values([
      { id: 'contact-ai-only', phone: '+6544444444', role: 'customer' },
      { id: 'contact-human-2', phone: '+6555555555', role: 'customer' },
    ]);
    await db.insert(interactions).values([
      {
        id: 'conv-ai-1',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-ai-only',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'active',
        mode: 'ai',
      },
      {
        id: 'conv-human-1',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-human-2',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'active',
        mode: 'human',
      },
    ]);

    const res = await app.request(`${BASE}/interactions/ai-active`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Only the ai-only contact, not the human one (which is in attention)
    expect(body.length).toBe(1);
    expect(body[0].id).toBe('contact-ai-only');
  });

  it('GET /interactions/resolved returns contacts where all interactions are terminal', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    // Contact with only resolved/failed interactions
    await db.insert(contacts).values([
      { id: 'contact-done', phone: '+6566666666', role: 'customer' },
      { id: 'contact-mixed', phone: '+6577777777', role: 'customer' },
    ]);
    await db.insert(interactions).values([
      {
        id: 'conv-done',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-done',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'resolved',
      },
      {
        id: 'conv-failed',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-done',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'failed',
      },
      // Mixed contact: has active + resolved — should NOT be in done
      {
        id: 'conv-mixed-active',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-mixed',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'active',
      },
      {
        id: 'conv-mixed-done',
        channelRoutingId: 'ep-tab',
        contactId: 'contact-mixed',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'resolved',
      },
    ]);

    const res = await app.request(`${BASE}/interactions/resolved`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Only contact-done (all terminal), not contact-mixed (has active)
    expect(body.length).toBe(1);
    expect(body[0].id).toBe('contact-done');
  });

  it('GET /interactions/counts returns accurate contact-level tab counts', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    await db.insert(contacts).values([
      { id: 'cnt-c1', phone: '+6588881111', role: 'customer' },
      { id: 'cnt-c2', phone: '+6588882222', role: 'customer' },
      { id: 'cnt-c3', phone: '+6588883333', role: 'customer' },
    ]);
    await db.insert(interactions).values([
      {
        id: 'cnt-human',
        channelRoutingId: 'ep-tab',
        contactId: 'cnt-c1',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'active',
        mode: 'human',
      },
      {
        id: 'cnt-ai',
        channelRoutingId: 'ep-tab',
        contactId: 'cnt-c2',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'active',
        mode: 'ai',
      },
      {
        id: 'cnt-done',
        channelRoutingId: 'ep-tab',
        contactId: 'cnt-c3',
        agentId: 'booking',
        channelInstanceId: 'ci-web-test',
        status: 'resolved',
      },
    ]);

    const res = await app.request(`${BASE}/interactions/counts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attention).toBe(1);
    expect(body.active).toBe(1);
    expect(body.done).toBe(1);
  });

  it('route ordering: /interactions/attention is not matched as /:id', async () => {
    const app = createApp(db);

    // If /attention were matched as /:id, the handler would try to look up
    // an interaction with id='attention' and return 404. A correct route
    // ordering returns 200 with an array instead.
    const res = await app.request(`${BASE}/interactions/attention`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('waitingSince lifecycle', () => {
  beforeEach(async () => {
    await seedConversationFixtures(db);
    await db.insert(interactions).values({
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

    const res = await app.request(`${BASE}/interactions/conv-ws`, {
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

    // Set up a human-mode interaction with waitingSince already set
    await db.insert(interactions).values({
      id: 'conv-ws-human',
      channelRoutingId: 'ep-tab',
      contactId: 'contact-tab',
      agentId: 'booking',
      channelInstanceId: 'ci-web-test',
      status: 'active',
      mode: 'human',
      waitingSince: new Date('2024-01-01T00:00:00Z'),
    });

    const res = await app.request(`${BASE}/interactions/conv-ws-human`, {
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

    await db.insert(interactions).values({
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

    const res = await app.request(`${BASE}/interactions/conv-ws-hb/handback`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify DB state directly — handback returns { success, mode } not the full record
    const [conv] = await db
      .select({
        mode: interactions.mode,
        waitingSince: interactions.waitingSince,
        hasPendingEscalation: interactions.hasPendingEscalation,
      })
      .from(interactions)
      .where(eq(interactions.id, 'conv-ws-hb'));
    expect(conv.mode).toBe('ai');
    expect(conv.waitingSince == null).toBe(true);
    expect(conv.hasPendingEscalation).toBe(false);
  });
});

describe('unreadCount', () => {
  it('POST /interactions/:id/read resets unreadCount to 0', async () => {
    const app = createApp(db);
    await seedConversationFixtures(db);

    await db.insert(interactions).values({
      id: 'conv-unread',
      channelRoutingId: 'ep-tab',
      contactId: 'contact-tab',
      agentId: 'booking',
      channelInstanceId: 'ci-web-test',
      status: 'active',
      mode: 'human',
      unreadCount: 5,
    });

    const res = await app.request(`${BASE}/interactions/conv-unread/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastReadMessageId: 'msg-last' }),
    });

    expect(res.status).toBe(200);

    const [conv] = await db
      .select({ unreadCount: interactions.unreadCount })
      .from(interactions)
      .where(eq(interactions.id, 'conv-unread'));
    expect(conv.unreadCount).toBe(0);
  });
});
