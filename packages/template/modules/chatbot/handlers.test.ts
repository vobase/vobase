import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';

import type { VobaseDb } from '@vobase/core';
import { errorHandler } from '@vobase/core';

import { createTestDb } from '../../lib/test-helpers';
import { chatAssistants, chatThreads, chatMessages } from './schema';
import { chatbotRoutes } from './handlers';

const BASE = 'http://localhost/api/chatbot';

function createApp(db: VobaseDb, user = { id: 'user-1', email: 'test@test.com', name: 'Test', role: 'user' }) {
  const app = new Hono();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('user', user);
    c.set('scheduler', {} as never);
    c.set('storage', {} as never);
    c.set('notify', {} as never);
    c.set('http', {} as never);
    await next();
  });
  app.route('/api/chatbot', chatbotRoutes);
  return app;
}

describe('Chatbot Routes', () => {
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

  describe('Assistants', () => {
    it('POST /assistants creates assistant and returns 201', async () => {
      const res = await app.request(`${BASE}/assistants`, {
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

    it('GET /assistants lists only current user assistants', async () => {
      // Insert one for user-1 and one for user-2 directly
      await db.insert(chatAssistants).values({ id: 'asst-a', name: 'Bot A', userId: 'user-1' });
      await db.insert(chatAssistants).values({ id: 'asst-b', name: 'Bot B', userId: 'user-2' });

      const res = await app.request(`${BASE}/assistants`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Bot A');
    });

    it('GET /assistants/:id returns assistant', async () => {
      await db.insert(chatAssistants).values({ id: 'asst-1', name: 'Helper', userId: 'user-1' });

      const res = await app.request(`${BASE}/assistants/asst-1`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('asst-1');
      expect(body.name).toBe('Helper');
    });

    it('GET /assistants/:id returns 404 for nonexistent', async () => {
      const res = await app.request(`${BASE}/assistants/no-such-id`);
      expect(res.status).toBe(404);
    });

    it('PUT /assistants/:id updates with ownership check', async () => {
      await db.insert(chatAssistants).values({ id: 'asst-upd', name: 'Old', userId: 'user-1' });

      const res = await app.request(`${BASE}/assistants/asst-upd`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New', systemPrompt: 'Updated prompt' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('New');
      expect(body.systemPrompt).toBe('Updated prompt');
    });

    it('PUT /assistants/:id returns 404 for wrong user', async () => {
      await db.insert(chatAssistants).values({ id: 'asst-other', name: 'Other', userId: 'user-2' });

      const res = await app.request(`${BASE}/assistants/asst-other`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hacked' }),
      });

      expect(res.status).toBe(404);

      // Verify original unchanged
      const asst = await db.select().from(chatAssistants).where(eq(chatAssistants.id, 'asst-other')).get();
      expect(asst!.name).toBe('Other');
    });

    it('DELETE /assistants/:id removes assistant with ownership', async () => {
      await db.insert(chatAssistants).values({ id: 'asst-del', name: 'Delete Me', userId: 'user-1' });

      const res = await app.request(`${BASE}/assistants/asst-del`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const asst = await db.select().from(chatAssistants).where(eq(chatAssistants.id, 'asst-del')).get();
      expect(asst).toBeUndefined();
    });

    it('stores tools and kbSourceIds as JSON', async () => {
      const res = await app.request(`${BASE}/assistants`, {
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
      await db.insert(chatAssistants).values({ id: 'asst-t', name: 'Thread Bot', userId: 'user-1' });
    });

    it('POST /threads creates thread and returns 201', async () => {
      const res = await app.request(`${BASE}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Thread', assistantId: 'asst-t' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.title).toBe('New Thread');
      expect(body.userId).toBe('user-1');
      expect(body.assistantId).toBe('asst-t');
    });

    it('GET /threads lists user threads', async () => {
      await db.insert(chatThreads).values({ id: 'thr-a', title: 'Mine', assistantId: 'asst-t', userId: 'user-1' });
      await db.insert(chatThreads).values({ id: 'thr-b', title: 'Others', assistantId: 'asst-t', userId: 'user-2' });

      const res = await app.request(`${BASE}/threads`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe('Mine');
    });

    it('GET /threads/:id returns thread with messages', async () => {
      await db.insert(chatThreads).values({ id: 'thr-get', title: 'My Thread', assistantId: 'asst-t', userId: 'user-1' });
      await db.insert(chatMessages).values({ id: 'msg-1', threadId: 'thr-get', role: 'user', content: 'Hello' });
      await db.insert(chatMessages).values({ id: 'msg-2', threadId: 'thr-get', role: 'assistant', content: 'Hi!' });

      const res = await app.request(`${BASE}/threads/thr-get`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe('My Thread');
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].content).toBe('Hello');
      expect(body.messages[1].content).toBe('Hi!');
    });

    it('GET /threads/:id returns 404 for wrong user', async () => {
      await db.insert(chatThreads).values({ id: 'thr-other', title: 'Not Mine', assistantId: 'asst-t', userId: 'user-2' });

      const res = await app.request(`${BASE}/threads/thr-other`);
      expect(res.status).toBe(404);
    });

    it('DELETE /threads/:id removes thread and its messages', async () => {
      await db.insert(chatThreads).values({ id: 'thr-del', title: 'Delete Me', assistantId: 'asst-t', userId: 'user-1' });
      await db.insert(chatMessages).values({ id: 'msg-1', threadId: 'thr-del', role: 'user', content: 'Hello' });
      await db.insert(chatMessages).values({ id: 'msg-2', threadId: 'thr-del', role: 'assistant', content: 'Hi!' });

      const res = await app.request(`${BASE}/threads/thr-del`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const msgs = await db.select().from(chatMessages).where(eq(chatMessages.threadId, 'thr-del'));
      expect(msgs).toHaveLength(0);

      const thread = await db.select().from(chatThreads).where(eq(chatThreads.id, 'thr-del')).get();
      expect(thread).toBeUndefined();
    });

    it('DELETE /threads/:id returns 404 for wrong user', async () => {
      await db.insert(chatThreads).values({ id: 'thr-nope', title: 'Not Mine', assistantId: 'asst-t', userId: 'user-2' });

      const res = await app.request(`${BASE}/threads/thr-nope`, { method: 'DELETE' });
      expect(res.status).toBe(404);

      // Thread still exists
      const thread = await db.select().from(chatThreads).where(eq(chatThreads.id, 'thr-nope')).get();
      expect(thread).toBeDefined();
    });
  });

  describe('Messages', () => {
    beforeEach(async () => {
      await db.insert(chatAssistants).values({ id: 'asst-m', name: 'Msg Bot', userId: 'user-1' });
      await db.insert(chatThreads).values({ id: 'thr-m', title: 'Msg Thread', assistantId: 'asst-m', userId: 'user-1' });
    });

    it('POST /threads/:id/messages creates user message and returns AI-not-configured response', async () => {
      const res = await app.request(`${BASE}/threads/thr-m/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello, bot!' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.role).toBe('assistant');
      expect(body.content).toContain('AI is not configured');

      // Verify user message was also saved
      const msgs = await db.select().from(chatMessages).where(eq(chatMessages.threadId, 'thr-m'));
      expect(msgs).toHaveLength(2);
      const userMsg = msgs.find((m) => m.role === 'user');
      expect(userMsg!.content).toBe('Hello, bot!');
    });

    it('messages are ordered by creation time in GET thread', async () => {
      await db.insert(chatMessages).values({ id: 'msg-1', threadId: 'thr-m', role: 'user', content: 'First' });
      await db.insert(chatMessages).values({ id: 'msg-2', threadId: 'thr-m', role: 'assistant', content: 'Second' });
      await db.insert(chatMessages).values({ id: 'msg-3', threadId: 'thr-m', role: 'user', content: 'Third' });

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
