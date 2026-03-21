import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { errorHandler } from '@vobase/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { createTestDb } from '../../lib/test-helpers';
import { messagingRoutes } from './handlers';
import { msgMessages, msgThreads } from './schema';

const BASE = 'http://localhost/api/messaging';

function createApp(
  db: VobaseDb,
  user = { id: 'user-1', email: 'test@test.com', name: 'Test', role: 'user' },
) {
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
  let pglite: PGlite;
  let db: VobaseDb;
  let app: Hono;

  beforeEach(async () => {
    const testDb = await createTestDb();
    pglite = testDb.pglite;
    db = testDb.db;
    app = createApp(db);
  });

  afterEach(async () => {
    await pglite.close();
  });

  describe('Agents (read-only)', () => {
    it('GET /agents returns code-defined agents', async () => {
      const res = await app.request(`${BASE}/agents`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
      // First agent should be the assistant
      expect(body[0].id).toBe('assistant');
      expect(body[0].name).toBe('Vobase Assistant');
      expect(body[0].instructions).toBeDefined();
    });

    it('GET /agents/:id returns specific agent', async () => {
      const res = await app.request(`${BASE}/agents/assistant`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('assistant');
      expect(body.name).toBe('Vobase Assistant');
    });

    it('GET /agents/:id returns 404 for unknown agent', async () => {
      const res = await app.request(`${BASE}/agents/nonexistent`);
      expect(res.status).toBe(404);
    });
  });

  describe('Threads', () => {
    it('POST /threads returns 404 for invalid agentId', async () => {
      const res = await app.request(`${BASE}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'nonexistent-agent' }),
      });

      expect(res.status).toBe(404);
    });

    it('POST /threads creates thread and returns 201', async () => {
      const res = await app.request(`${BASE}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Thread', agentId: 'assistant' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.title).toBe('New Thread');
      expect(body.userId).toBe('user-1');
      expect(body.agentId).toBe('assistant');
    });

    it('GET /threads lists user threads', async () => {
      await db.insert(msgThreads).values({
        id: 'thr-a',
        title: 'Mine',
        agentId: 'assistant',
        userId: 'user-1',
      });
      await db.insert(msgThreads).values({
        id: 'thr-b',
        title: 'Others',
        agentId: 'assistant',
        userId: 'user-2',
      });

      const res = await app.request(`${BASE}/threads`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe('Mine');
    });

    it('GET /threads/:id returns thread with messages', async () => {
      await db.insert(msgThreads).values({
        id: 'thr-get',
        title: 'My Thread',
        agentId: 'assistant',
        userId: 'user-1',
      });
      await db.insert(msgMessages).values({
        id: 'msg-1',
        threadId: 'thr-get',
        direction: 'inbound',
        senderType: 'user',
        aiRole: 'user',
        content: 'Hello',
      });
      await db.insert(msgMessages).values({
        id: 'msg-2',
        threadId: 'thr-get',
        direction: 'outbound',
        senderType: 'agent',
        aiRole: 'assistant',
        content: 'Hi!',
      });

      const res = await app.request(`${BASE}/threads/thr-get`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe('My Thread');
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].content).toBe('Hello');
      expect(body.messages[1].content).toBe('Hi!');
    });

    it('GET /threads/:id returns 404 for wrong user', async () => {
      await db.insert(msgThreads).values({
        id: 'thr-other',
        title: 'Not Mine',
        agentId: 'assistant',
        userId: 'user-2',
      });

      const res = await app.request(`${BASE}/threads/thr-other`);
      expect(res.status).toBe(404);
    });

    it('DELETE /threads/:id removes thread and its messages', async () => {
      await db.insert(msgThreads).values({
        id: 'thr-del',
        title: 'Delete Me',
        agentId: 'assistant',
        userId: 'user-1',
      });
      await db.insert(msgMessages).values({
        id: 'msg-1',
        threadId: 'thr-del',
        direction: 'inbound',
        senderType: 'user',
        aiRole: 'user',
        content: 'Hello',
      });
      await db.insert(msgMessages).values({
        id: 'msg-2',
        threadId: 'thr-del',
        direction: 'outbound',
        senderType: 'agent',
        aiRole: 'assistant',
        content: 'Hi!',
      });

      const res = await app.request(`${BASE}/threads/thr-del`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const msgs = await db
        .select()
        .from(msgMessages)
        .where(eq(msgMessages.threadId, 'thr-del'));
      expect(msgs).toHaveLength(0);

      const [thread] = await db
        .select()
        .from(msgThreads)
        .where(eq(msgThreads.id, 'thr-del'));
      expect(thread).toBeUndefined();
    });

    it('DELETE /threads/:id returns 404 for wrong user', async () => {
      await db.insert(msgThreads).values({
        id: 'thr-nope',
        title: 'Not Mine',
        agentId: 'assistant',
        userId: 'user-2',
      });

      const res = await app.request(`${BASE}/threads/thr-nope`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);

      // Thread still exists
      const [thread] = await db
        .select()
        .from(msgThreads)
        .where(eq(msgThreads.id, 'thr-nope'));
      expect(thread).toBeDefined();
    });
  });

  describe('Chat endpoint guards', () => {
    it('POST /threads/:id/chat returns 400 when thread has no agentId', async () => {
      await db.insert(msgThreads).values({
        id: 'thr-no-agent',
        title: 'No Agent',
        agentId: null,
        userId: 'user-1',
      });

      const res = await app.request(`${BASE}/threads/thr-no-agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              parts: [{ type: 'text', text: 'hi' }],
            },
          ],
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('no agent');
    });

    it('POST /threads/:id/chat returns 404 when thread not found', async () => {
      const res = await app.request(`${BASE}/threads/nonexistent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              parts: [{ type: 'text', text: 'hi' }],
            },
          ],
        }),
      });

      expect(res.status).toBe(404);
    });

    it('POST /threads/:id/chat returns 503 when AI not configured', async () => {
      await db.insert(msgThreads).values({
        id: 'thr-no-ai',
        title: 'No AI',
        agentId: 'assistant',
        userId: 'user-1',
      });

      // Temporarily clear API keys so isAIConfigured() returns false
      const savedKeys = {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      };
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const res = await app.request(`${BASE}/threads/thr-no-ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              parts: [{ type: 'text', text: 'hi' }],
            },
          ],
        }),
      });

      // Restore keys
      Object.assign(process.env, savedKeys);

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toContain('AI is not configured');
    });

    it('POST /threads/:id/chat saves user message and sets thread title', async () => {
      await db.insert(msgThreads).values({
        id: 'thr-title',
        title: null,
        agentId: 'assistant',
        userId: 'user-1',
      });

      // Will return 503 (no AI key) but should still save user msg + set title
      await app.request(`${BASE}/threads/thr-title/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              parts: [{ type: 'text', text: 'Hello bot' }],
            },
          ],
        }),
      });

      // Verify user message saved
      const msgs = await db
        .select()
        .from(msgMessages)
        .where(eq(msgMessages.threadId, 'thr-title'));
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe('Hello bot');
      expect(msgs[0].aiRole).toBe('user');

      // Verify title set
      const [thread] = await db
        .select()
        .from(msgThreads)
        .where(eq(msgThreads.id, 'thr-title'));
      expect(thread.title).toBe('Hello bot');
    });
  });

  describe('Messages', () => {
    beforeEach(async () => {
      await db.insert(msgThreads).values({
        id: 'thr-m',
        title: 'Msg Thread',
        agentId: 'assistant',
        userId: 'user-1',
      });
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
      const msgs = await db
        .select()
        .from(msgMessages)
        .where(eq(msgMessages.threadId, 'thr-m'));
      expect(msgs).toHaveLength(1);
      expect(msgs[0].direction).toBe('inbound');
      expect(msgs[0].senderType).toBe('user');
      expect(msgs[0].aiRole).toBe('user');
      expect(msgs[0].content).toBe('Hello, bot!');
    });

    it('messages are ordered by creation time in GET thread', async () => {
      await db.insert(msgMessages).values({
        id: 'msg-1',
        threadId: 'thr-m',
        direction: 'inbound',
        senderType: 'user',
        aiRole: 'user',
        content: 'First',
      });
      await db.insert(msgMessages).values({
        id: 'msg-2',
        threadId: 'thr-m',
        direction: 'outbound',
        senderType: 'agent',
        aiRole: 'assistant',
        content: 'Second',
      });
      await db.insert(msgMessages).values({
        id: 'msg-3',
        threadId: 'thr-m',
        direction: 'inbound',
        senderType: 'user',
        aiRole: 'user',
        content: 'Third',
      });

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
