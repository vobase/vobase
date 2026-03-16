import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';

import type { VobaseDb } from '@vobase/core';
import { errorHandler } from '@vobase/core';

import { createTestDb } from '../../lib/test-helpers';
import { msgAgents, msgThreads, msgMessages } from './schema';
import { messagingRoutes } from './handlers';

const BASE = 'http://localhost/api/messaging';

function createApp(db: VobaseDb, user = { id: 'user-1', email: 'test@test.com', name: 'Test', role: 'user' }) {
  const app = new Hono();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('user', user);
    c.set('scheduler', {} as never);
    c.set('storage', {} as never);
    c.set('channels', {} as never);
    c.set('http', {} as never);
    await next();
  });
  app.route('/api/messaging', messagingRoutes);
  return app;
}

describe('Messaging Routes', () => {
  let sqlite: InstanceType<typeof Database>;
  let db: VobaseDb;
  let app: Hono;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    db = testDb.db;
    app = createApp(db);
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('Agents', () => {
    it('POST /agents creates agent and returns 201', async () => {
      const res = await app.request(`${BASE}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Helper Bot', systemPrompt: 'You are helpful.' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe('Helper Bot');
      expect(body.systemPrompt).toBe('You are helpful.');
      expect(body.userId).toBe('user-1');
      expect(body.isPublished).toBe(false);
      expect(body.id).toBeDefined();
    });

    it('GET /agents lists only current user agents', async () => {
      // Insert one for user-1 and one for user-2 directly
      await db.insert(msgAgents).values({ id: 'agent-a', name: 'Bot A', userId: 'user-1' });
      await db.insert(msgAgents).values({ id: 'agent-b', name: 'Bot B', userId: 'user-2' });

      const res = await app.request(`${BASE}/agents`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Bot A');
    });

    it('GET /agents/:id returns agent', async () => {
      await db.insert(msgAgents).values({ id: 'agent-1', name: 'Helper', userId: 'user-1' });

      const res = await app.request(`${BASE}/agents/agent-1`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('agent-1');
      expect(body.name).toBe('Helper');
    });

    it('GET /agents/:id returns 404 for nonexistent', async () => {
      const res = await app.request(`${BASE}/agents/no-such-id`);
      expect(res.status).toBe(404);
    });

    it('PUT /agents/:id updates with ownership check', async () => {
      await db.insert(msgAgents).values({ id: 'agent-upd', name: 'Old', userId: 'user-1' });

      const res = await app.request(`${BASE}/agents/agent-upd`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New', systemPrompt: 'Updated prompt' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('New');
      expect(body.systemPrompt).toBe('Updated prompt');
    });

    it('PUT /agents/:id returns 404 for wrong user', async () => {
      await db.insert(msgAgents).values({ id: 'agent-other', name: 'Other', userId: 'user-2' });

      const res = await app.request(`${BASE}/agents/agent-other`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hacked' }),
      });

      expect(res.status).toBe(404);

      // Verify original unchanged
      const agent = await db.select().from(msgAgents).where(eq(msgAgents.id, 'agent-other')).get();
      expect(agent!.name).toBe('Other');
    });

    it('DELETE /agents/:id removes agent with ownership', async () => {
      await db.insert(msgAgents).values({ id: 'agent-del', name: 'Delete Me', userId: 'user-1' });

      const res = await app.request(`${BASE}/agents/agent-del`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const agent = await db.select().from(msgAgents).where(eq(msgAgents.id, 'agent-del')).get();
      expect(agent).toBeUndefined();
    });

    it('stores tools and kbSourceIds as JSON', async () => {
      const res = await app.request(`${BASE}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'JSON Bot',
          tools: ['search_knowledge_base'],
          kbSourceIds: ['src-1', 'src-2'],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(JSON.parse(body.tools)).toEqual(['search_knowledge_base']);
      expect(JSON.parse(body.kbSourceIds)).toEqual(['src-1', 'src-2']);
    });
  });

  describe('Threads', () => {
    beforeEach(async () => {
      await db.insert(msgAgents).values({ id: 'agent-t', name: 'Thread Bot', userId: 'user-1' });
    });

    it('POST /threads creates thread and returns 201', async () => {
      const res = await app.request(`${BASE}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Thread', agentId: 'agent-t' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.title).toBe('New Thread');
      expect(body.userId).toBe('user-1');
      expect(body.agentId).toBe('agent-t');
    });

    it('GET /threads lists user threads', async () => {
      await db.insert(msgThreads).values({ id: 'thr-a', title: 'Mine', agentId: 'agent-t', userId: 'user-1' });
      await db.insert(msgThreads).values({ id: 'thr-b', title: 'Others', agentId: 'agent-t', userId: 'user-2' });

      const res = await app.request(`${BASE}/threads`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe('Mine');
    });

    it('GET /threads/:id returns thread with messages', async () => {
      await db.insert(msgThreads).values({ id: 'thr-get', title: 'My Thread', agentId: 'agent-t', userId: 'user-1' });
      await db.insert(msgMessages).values({ id: 'msg-1', threadId: 'thr-get', direction: 'inbound', senderType: 'user', aiRole: 'user', content: 'Hello' });
      await db.insert(msgMessages).values({ id: 'msg-2', threadId: 'thr-get', direction: 'outbound', senderType: 'agent', aiRole: 'assistant', content: 'Hi!' });

      const res = await app.request(`${BASE}/threads/thr-get`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe('My Thread');
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].content).toBe('Hello');
      expect(body.messages[1].content).toBe('Hi!');
    });

    it('GET /threads/:id returns 404 for wrong user', async () => {
      await db.insert(msgThreads).values({ id: 'thr-other', title: 'Not Mine', agentId: 'agent-t', userId: 'user-2' });

      const res = await app.request(`${BASE}/threads/thr-other`);
      expect(res.status).toBe(404);
    });

    it('DELETE /threads/:id removes thread and its messages', async () => {
      await db.insert(msgThreads).values({ id: 'thr-del', title: 'Delete Me', agentId: 'agent-t', userId: 'user-1' });
      await db.insert(msgMessages).values({ id: 'msg-1', threadId: 'thr-del', direction: 'inbound', senderType: 'user', aiRole: 'user', content: 'Hello' });
      await db.insert(msgMessages).values({ id: 'msg-2', threadId: 'thr-del', direction: 'outbound', senderType: 'agent', aiRole: 'assistant', content: 'Hi!' });

      const res = await app.request(`${BASE}/threads/thr-del`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const msgs = await db.select().from(msgMessages).where(eq(msgMessages.threadId, 'thr-del'));
      expect(msgs).toHaveLength(0);

      const thread = await db.select().from(msgThreads).where(eq(msgThreads.id, 'thr-del')).get();
      expect(thread).toBeUndefined();
    });

    it('DELETE /threads/:id returns 404 for wrong user', async () => {
      await db.insert(msgThreads).values({ id: 'thr-nope', title: 'Not Mine', agentId: 'agent-t', userId: 'user-2' });

      const res = await app.request(`${BASE}/threads/thr-nope`, { method: 'DELETE' });
      expect(res.status).toBe(404);

      // Thread still exists
      const thread = await db.select().from(msgThreads).where(eq(msgThreads.id, 'thr-nope')).get();
      expect(thread).toBeDefined();
    });
  });

  describe('Messages', () => {
    beforeEach(async () => {
      await db.insert(msgAgents).values({ id: 'agent-m', name: 'Msg Bot', userId: 'user-1' });
      await db.insert(msgThreads).values({ id: 'thr-m', title: 'Msg Thread', agentId: 'agent-m', userId: 'user-1' });
    });

    it('POST /threads/:id/messages creates message with direction/senderType/aiRole', async () => {
      const res = await app.request(`${BASE}/threads/thr-m/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello, bot!' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify message was saved with correct fields
      const msgs = await db.select().from(msgMessages).where(eq(msgMessages.threadId, 'thr-m'));
      expect(msgs).toHaveLength(1);
      expect(msgs[0].direction).toBe('inbound');
      expect(msgs[0].senderType).toBe('user');
      expect(msgs[0].aiRole).toBe('user');
      expect(msgs[0].content).toBe('Hello, bot!');
    });

    it('messages are ordered by creation time in GET thread', async () => {
      await db.insert(msgMessages).values({ id: 'msg-1', threadId: 'thr-m', direction: 'inbound', senderType: 'user', aiRole: 'user', content: 'First' });
      await db.insert(msgMessages).values({ id: 'msg-2', threadId: 'thr-m', direction: 'outbound', senderType: 'agent', aiRole: 'assistant', content: 'Second' });
      await db.insert(msgMessages).values({ id: 'msg-3', threadId: 'thr-m', direction: 'inbound', senderType: 'user', aiRole: 'user', content: 'Third' });

      const res = await app.request(`${BASE}/threads/thr-m`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toHaveLength(3);
      expect(body.messages[0].content).toBe('First');
      expect(body.messages[1].content).toBe('Second');
      expect(body.messages[2].content).toBe('Third');
    });
  });
});
