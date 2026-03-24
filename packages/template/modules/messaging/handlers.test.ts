import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { errorHandler } from '@vobase/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { createTestDb } from '../../lib/test-helpers';
import { messagingRoutes } from './handlers';
import { msgConversations, msgOutbox } from './schema';

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
    c.set('realtime', {
      subscribe: () => () => {},
      notify: async () => {},
      shutdown: async () => {},
    } as never);
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
      expect(body[0].id).toBe('assistant');
      expect(body[0].name).toBe('Vobase Assistant');
      expect(body[0].channels).toBeDefined();
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

  describe('Conversations', () => {
    it('POST /conversations returns 404 for invalid agentId', async () => {
      const res = await app.request(`${BASE}/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'nonexistent-agent' }),
      });

      expect(res.status).toBe(404);
    });

    it('POST /conversations creates conversation and returns 201', async () => {
      const res = await app.request(`${BASE}/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New Conversation',
          agentId: 'assistant',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.title).toBe('New Conversation');
      expect(body.userId).toBe('user-1');
      expect(body.agentId).toBe('assistant');
    });

    it('GET /conversations lists user conversations', async () => {
      await db.insert(msgConversations).values({
        id: 'conv-a',
        title: 'Mine',
        agentId: 'assistant',
        userId: 'user-1',
      });
      await db.insert(msgConversations).values({
        id: 'conv-b',
        title: 'Others',
        agentId: 'assistant',
        userId: 'user-2',
      });

      const res = await app.request(`${BASE}/conversations`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe('Mine');
    });

    it('GET /conversations/:id returns conversation (messages loaded from Memory)', async () => {
      await db.insert(msgConversations).values({
        id: 'conv-get',
        title: 'My Conversation',
        agentId: 'assistant',
        userId: 'user-1',
      });

      const res = await app.request(`${BASE}/conversations/conv-get`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe('My Conversation');
      // Messages come from Memory — empty when Memory not initialized in tests
      expect(body.messages).toBeDefined();
    });

    it('GET /conversations/:id returns 404 for wrong user', async () => {
      await db.insert(msgConversations).values({
        id: 'conv-other',
        title: 'Not Mine',
        agentId: 'assistant',
        userId: 'user-2',
      });

      const res = await app.request(`${BASE}/conversations/conv-other`);
      expect(res.status).toBe(404);
    });

    it('DELETE /conversations/:id removes conversation and outbox entries', async () => {
      await db.insert(msgConversations).values({
        id: 'conv-del',
        title: 'Delete Me',
        agentId: 'assistant',
        userId: 'user-1',
      });
      await db.insert(msgOutbox).values({
        conversationId: 'conv-del',
        content: 'Queued message',
        channel: 'web',
        status: 'queued',
      });

      const res = await app.request(`${BASE}/conversations/conv-del`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const outbox = await db
        .select()
        .from(msgOutbox)
        .where(eq(msgOutbox.conversationId, 'conv-del'));
      expect(outbox).toHaveLength(0);

      const [conversation] = await db
        .select()
        .from(msgConversations)
        .where(eq(msgConversations.id, 'conv-del'));
      expect(conversation).toBeUndefined();
    });

    it('DELETE /conversations/:id returns 404 for wrong user', async () => {
      await db.insert(msgConversations).values({
        id: 'conv-nope',
        title: 'Not Mine',
        agentId: 'assistant',
        userId: 'user-2',
      });

      const res = await app.request(`${BASE}/conversations/conv-nope`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);

      const [conversation] = await db
        .select()
        .from(msgConversations)
        .where(eq(msgConversations.id, 'conv-nope'));
      expect(conversation).toBeDefined();
    });
  });

  describe('Chat endpoint guards', () => {
    it('POST /conversations/:id/chat returns 400 when conversation has no agentId', async () => {
      await db.insert(msgConversations).values({
        id: 'conv-no-agent',
        title: 'No Agent',
        agentId: null,
        userId: 'user-1',
      });

      const res = await app.request(
        `${BASE}/conversations/conv-no-agent/chat`,
        {
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
        },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('no agent');
    });

    it('POST /conversations/:id/chat returns 404 when conversation not found', async () => {
      const res = await app.request(`${BASE}/conversations/nonexistent/chat`, {
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

    it('POST /conversations/:id/chat returns 503 when AI not configured', async () => {
      await db.insert(msgConversations).values({
        id: 'conv-no-ai',
        title: 'No AI',
        agentId: 'assistant',
        userId: 'user-1',
      });

      const savedKeys = {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      };
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      const res = await app.request(`${BASE}/conversations/conv-no-ai/chat`, {
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

      Object.assign(process.env, savedKeys);

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toContain('AI is not configured');
    });

    it('POST /conversations/:id/chat sets conversation title from first user message', async () => {
      await db.insert(msgConversations).values({
        id: 'conv-title',
        title: null,
        agentId: 'assistant',
        userId: 'user-1',
      });

      // Will return 503 (no AI key) but should still set title
      await app.request(`${BASE}/conversations/conv-title/chat`, {
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

      const [conversation] = await db
        .select()
        .from(msgConversations)
        .where(eq(msgConversations.id, 'conv-title'));
      expect(conversation.title).toBe('Hello bot');
    });
  });
});
