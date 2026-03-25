import { toAISdkStream } from '@mastra/ai-sdk';
import { getCtx, notFound, unauthorized, validation } from '@vobase/core';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getMemory } from '../../mastra';
import { getAgent, listAgents } from '../../mastra/agents';
import { streamChat } from './lib/chat-stream';
import { createSession } from './lib/session';
import { consultations, endpoints, outbox, sessions } from './schema';

export const conversationsRoutes = new Hono();

// ─── Schemas ─────────────────────────────────────────────────────────

const chatSchema = z.object({
  sessionId: z.string().optional(),
  agentId: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string(),
    }),
  ),
});

const createEndpointSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(['whatsapp', 'web', 'email']),
  agentId: z.string().min(1),
  assignmentPattern: z
    .enum(['direct', 'router', 'workflow'])
    .optional()
    .default('direct'),
  config: z.record(z.string(), z.unknown()).optional(),
});

const updateEndpointSchema = z.object({
  name: z.string().min(1).optional(),
  channel: z.enum(['whatsapp', 'web', 'email']).optional(),
  agentId: z.string().min(1).optional(),
  assignmentPattern: z.enum(['direct', 'router', 'workflow']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

const updateSessionSchema = z.object({
  status: z.enum(['paused', 'completed', 'failed']),
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Chat (Web) ─────────────────────────────────────────────────────

/** POST /chat — Web chat: stream agent response. Creates session if needed. */
conversationsRoutes.post('/chat', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const body = chatSchema.parse(await c.req.json());

  // Validate agent exists
  const registered = getAgent(body.agentId);
  if (!registered) throw notFound('Agent not found');

  // Resolve or create session
  let sessionId = body.sessionId;
  if (!sessionId) {
    // Find or create a web endpoint for this agent
    let [endpoint] = await db
      .select()
      .from(endpoints)
      .where(
        and(
          eq(endpoints.channel, 'web'),
          eq(endpoints.agentId, body.agentId),
          eq(endpoints.enabled, true),
        ),
      );

    if (!endpoint) {
      [endpoint] = await db
        .insert(endpoints)
        .values({
          name: `${registered.meta.name} - Web`,
          channel: 'web',
          agentId: body.agentId,
          assignmentPattern: 'direct',
        })
        .returning();
    }

    const session = await createSession(db, {
      endpointId: endpoint.id,
      contactId: user.id,
      agentId: body.agentId,
      channel: 'web',
    });
    sessionId = session.id;
  }

  // Extract last user message for streaming
  const lastUserMessage =
    [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  // Stream response
  const result = await streamChat({
    sessionId,
    message: lastUserMessage,
    agentId: body.agentId,
    resourceId: `user:${user.id}`,
  });

  // Bridge Mastra stream to AI SDK SSE format
  const stream = toAISdkStream(result, { from: 'agent' });

  return new Response(stream as unknown as BodyInit, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Session-Id': sessionId,
    },
  });
});

// ─── Sessions ────────────────────────────────────────────────────────

/** GET /sessions — List sessions with filters and pagination. */
conversationsRoutes.get('/sessions', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query('limit'),
    offset: c.req.query('offset'),
  });

  const agentId = c.req.query('agentId');
  const contactId = c.req.query('contactId');
  const status = c.req.query('status');
  const channel = c.req.query('channel');

  const conditions = [];
  if (agentId) conditions.push(eq(sessions.agentId, agentId));
  if (contactId) conditions.push(eq(sessions.contactId, contactId));
  if (status) conditions.push(eq(sessions.status, status));
  if (channel) conditions.push(eq(sessions.channel, channel));

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
conversationsRoutes.get('/sessions/:id', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, c.req.param('id')));

  if (!session) throw notFound('Session not found');

  return c.json(session);
});

/** GET /sessions/:id/messages — Load messages from Mastra Memory. */
conversationsRoutes.get('/sessions/:id/messages', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const sessionId = c.req.param('id');

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) throw notFound('Session not found');

  try {
    const memory = getMemory();
    const result = await memory.recall({ threadId: sessionId });
    return c.json({ messages: result?.messages ?? [] });
  } catch {
    return c.json({ messages: [] });
  }
});

/** PATCH /sessions/:id — Update session status. */
conversationsRoutes.patch('/sessions/:id', async (c) => {
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
    const { completeSession, failSession } = await import('./lib/session');
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

// ─── Agents ──────────────────────────────────────────────────────────

/** GET /agents — List available agents from mastra registry. */
conversationsRoutes.get('/agents', async (c) => {
  const { user } = getCtx(c);
  if (!user) throw unauthorized();

  const agents = listAgents();
  return c.json(
    agents.map((a) => ({
      id: a.meta.id,
      name: a.meta.name,
      model: a.meta.model,
      channels: a.meta.channels ?? ['web'],
      suggestions: a.meta.suggestions ?? [],
    })),
  );
});

// ─── Stats ──────────────────────────────────────────────────────────

/** GET /stats — Per-agent consultation count + error rate for dashboard. */
conversationsRoutes.get('/stats', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  // Per-agent session counts (total + failed)
  const sessionStats = await db
    .select({
      agentId: sessions.agentId,
      total: count(),
      failed: count(sql`CASE WHEN ${sessions.status} = 'failed' THEN 1 END`),
    })
    .from(sessions)
    .groupBy(sessions.agentId);

  // Per-agent consultation counts (via session → consultation join)
  const consultationStats = await db
    .select({
      agentId: sessions.agentId,
      consultations: count(),
    })
    .from(consultations)
    .innerJoin(sessions, eq(consultations.sessionId, sessions.id))
    .groupBy(sessions.agentId);

  // Merge into a map
  const statsMap = new Map<
    string,
    { total: number; failed: number; consultations: number; errorRate: number }
  >();

  for (const row of sessionStats) {
    statsMap.set(row.agentId, {
      total: Number(row.total),
      failed: Number(row.failed),
      consultations: 0,
      errorRate:
        Number(row.total) > 0 ? Number(row.failed) / Number(row.total) : 0,
    });
  }

  for (const row of consultationStats) {
    const existing = statsMap.get(row.agentId);
    if (existing) {
      existing.consultations = Number(row.consultations);
    } else {
      statsMap.set(row.agentId, {
        total: 0,
        failed: 0,
        consultations: Number(row.consultations),
        errorRate: 0,
      });
    }
  }

  return c.json(Object.fromEntries(statsMap));
});

// ─── Outbox ─────────────────────────────────────────────────────────

/** POST /outbox/:id/retry — Retry a failed outbox message. */
conversationsRoutes.post('/outbox/:id/retry', async (c) => {
  const { db, user, scheduler } = getCtx(c);
  if (!user) throw unauthorized();

  const outboxId = c.req.param('id');

  const [record] = await db
    .select()
    .from(outbox)
    .where(eq(outbox.id, outboxId));

  if (!record) throw notFound('Outbox message not found');

  if (record.status !== 'failed') {
    throw validation({ status: 'Only failed messages can be retried' });
  }

  // Reset to queued and re-enqueue
  await db
    .update(outbox)
    .set({ status: 'queued' })
    .where(eq(outbox.id, outboxId));

  await scheduler.add('conversations:send', { outboxId });

  const [updated] = await db
    .select()
    .from(outbox)
    .where(eq(outbox.id, outboxId));

  return c.json(updated);
});

// ─── Endpoints ───────────────────────────────────────────────────────

/** GET /endpoints — List configured endpoints. */
conversationsRoutes.get('/endpoints', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const rows = await db
    .select()
    .from(endpoints)
    .orderBy(desc(endpoints.createdAt));

  return c.json(rows);
});

/** POST /endpoints — Create an endpoint. */
conversationsRoutes.post('/endpoints', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const body = createEndpointSchema.parse(await c.req.json());

  // Validate agent exists
  const registered = getAgent(body.agentId);
  if (!registered)
    throw validation({ agentId: `Agent '${body.agentId}' not found` });

  const [row] = await db
    .insert(endpoints)
    .values({
      name: body.name,
      channel: body.channel,
      agentId: body.agentId,
      assignmentPattern: body.assignmentPattern,
      config: body.config ?? {},
    })
    .returning();

  return c.json(row, 201);
});

/** PATCH /endpoints/:id — Update an endpoint. */
conversationsRoutes.patch('/endpoints/:id', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const body = updateEndpointSchema.parse(await c.req.json());
  const endpointId = c.req.param('id');

  const [existing] = await db
    .select()
    .from(endpoints)
    .where(eq(endpoints.id, endpointId));

  if (!existing) throw notFound('Endpoint not found');

  const [row] = await db
    .update(endpoints)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.channel !== undefined && { channel: body.channel }),
      ...(body.agentId !== undefined && { agentId: body.agentId }),
      ...(body.assignmentPattern !== undefined && {
        assignmentPattern: body.assignmentPattern,
      }),
      ...(body.config !== undefined && { config: body.config }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
    })
    .where(eq(endpoints.id, endpointId))
    .returning();

  return c.json(row);
});
