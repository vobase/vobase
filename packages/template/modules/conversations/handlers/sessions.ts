import { getCtx, notFound, unauthorized } from '@vobase/core';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getMemory } from '../../../mastra';
import { outbox, sessions } from '../schema';

const updateSessionSchema = z.object({
  status: z.enum(['paused', 'completed', 'failed']),
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const sessionsHandlers = new Hono();

/** GET /sessions — List sessions with filters and pagination. */
sessionsHandlers.get('/sessions', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });

  const agentId = c.req.query('agentId');
  const contactId = c.req.query('contactId');
  const status = c.req.query('status');
  const channelInstanceId = c.req.query('channelInstanceId');

  const conditions = [];
  if (agentId) conditions.push(eq(sessions.agentId, agentId));
  if (contactId) conditions.push(eq(sessions.contactId, contactId));
  if (status) conditions.push(eq(sessions.status, status));
  if (channelInstanceId)
    conditions.push(eq(sessions.channelInstanceId, channelInstanceId));

  const rows = await db
    .select()
    .from(sessions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sessions.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json(rows);
});

/** GET /sessions/:id — Session detail. */
sessionsHandlers.get('/sessions/:id', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, c.req.param('id')));

  if (!session) throw notFound('Session not found');

  return c.json(session);
});

/** GET /sessions/:id/messages — Load messages from Mastra Memory, fall back to outbox. */
sessionsHandlers.get('/sessions/:id/messages', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const sessionId = c.req.param('id');

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) throw notFound('Session not found');

  // Try Mastra Memory first (has full user+assistant transcript)
  try {
    const memory = getMemory();
    const result = await memory.recall({ threadId: sessionId });
    if (result?.messages && result.messages.length > 0) {
      return c.json({ messages: result.messages, source: 'memory' });
    }
  } catch {
    // Memory unavailable — fall through to outbox
  }

  // Fall back to outbox messages (agent responses only, no user messages)
  const outboxMessages = await db
    .select({
      id: outbox.id,
      content: outbox.content,
      status: outbox.status,
      createdAt: outbox.createdAt,
    })
    .from(outbox)
    .where(eq(outbox.sessionId, sessionId))
    .orderBy(asc(outbox.createdAt));

  const messages = outboxMessages.map((msg) => ({
    id: msg.id,
    role: 'assistant' as const,
    content: msg.content,
    createdAt: msg.createdAt,
  }));

  return c.json({ messages, source: 'outbox' });
});

/** PATCH /sessions/:id — Update session status. */
sessionsHandlers.patch('/sessions/:id', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const body = updateSessionSchema.parse(await c.req.json());
  const sessionId = c.req.param('id');

  const [existing] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!existing) throw notFound('Session not found');

  if (body.status === 'completed' || body.status === 'failed') {
    const { completeSession, failSession } = await import('../lib/session');
    if (body.status === 'completed') {
      await completeSession(db, sessionId);
    } else {
      await failSession(db, sessionId, 'Manually failed by user');
    }
  } else {
    await db
      .update(sessions)
      .set({ status: body.status })
      .where(eq(sessions.id, sessionId));
  }

  const [updated] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  return c.json(updated);
});
