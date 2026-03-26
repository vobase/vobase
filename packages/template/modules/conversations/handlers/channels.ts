import {
  conflict,
  getCtx,
  notFound,
  unauthorized,
  validation,
} from '@vobase/core';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getAgent } from '../../../mastra/agents';
import { channelInstances, endpoints, outbox, sessions } from '../schema';

const createChannelInstanceSchema = z.object({
  type: z.string().min(1),
  label: z.string().min(1),
  source: z.enum(['env', 'self', 'platform', 'sandbox']),
  integrationId: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const updateChannelInstanceSchema = z.object({
  label: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['active', 'disconnected', 'error']).optional(),
});

const createEndpointSchema = z.object({
  name: z.string().min(1),
  channelInstanceId: z.string().min(1),
  agentId: z.string().min(1),
  assignmentPattern: z
    .enum(['direct', 'router', 'workflow'])
    .optional()
    .default('direct'),
  config: z.record(z.string(), z.unknown()).optional(),
});

const updateEndpointSchema = z.object({
  name: z.string().min(1).optional(),
  channelInstanceId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  assignmentPattern: z.enum(['direct', 'router', 'workflow']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export const channelsHandlers = new Hono();

/** GET /instances — List all channel instances. */
channelsHandlers.get('/instances', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const rows = await db
    .select()
    .from(channelInstances)
    .orderBy(desc(channelInstances.createdAt));

  return c.json(rows);
});

/** GET /instances/:id — Get a single channel instance. */
channelsHandlers.get('/instances/:id', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const [row] = await db
    .select()
    .from(channelInstances)
    .where(eq(channelInstances.id, c.req.param('id')));

  if (!row) throw notFound('Channel instance not found');

  return c.json(row);
});

/** POST /instances — Create a channel instance. */
channelsHandlers.post('/instances', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const body = createChannelInstanceSchema.parse(await c.req.json());

  const [row] = await db
    .insert(channelInstances)
    .values({
      type: body.type,
      label: body.label,
      source: body.source,
      ...(body.integrationId !== undefined && {
        integrationId: body.integrationId,
      }),
      config: body.config ?? {},
    })
    .returning();

  return c.json(row, 201);
});

/** PATCH /instances/:id — Update a channel instance. */
channelsHandlers.patch('/instances/:id', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const body = updateChannelInstanceSchema.parse(await c.req.json());
  const instanceId = c.req.param('id');

  const [existing] = await db
    .select()
    .from(channelInstances)
    .where(eq(channelInstances.id, instanceId));

  if (!existing) throw notFound('Channel instance not found');

  const [row] = await db
    .update(channelInstances)
    .set({
      ...(body.label !== undefined && { label: body.label }),
      ...(body.config !== undefined && { config: body.config }),
      ...(body.status !== undefined && { status: body.status }),
    })
    .where(eq(channelInstances.id, instanceId))
    .returning();

  return c.json(row);
});

/** DELETE /instances/:id — Delete a channel instance. */
channelsHandlers.delete('/instances/:id', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const instanceId = c.req.param('id');

  const [existing] = await db
    .select()
    .from(channelInstances)
    .where(eq(channelInstances.id, instanceId));

  if (!existing) throw notFound('Channel instance not found');

  // M8: Prevent deletion if active sessions exist on endpoints bound to this instance
  const activeSessions = await db
    .select({ id: sessions.id })
    .from(sessions)
    .innerJoin(endpoints, eq(sessions.endpointId, endpoints.id))
    .where(
      and(
        eq(endpoints.channelInstanceId, instanceId),
        eq(sessions.status, 'active'),
      ),
    )
    .limit(1);

  if (activeSessions.length > 0) {
    throw conflict('Cannot delete channel instance with active sessions');
  }

  // Clean up completed sessions and endpoints before deleting instance (FK safety)
  const relatedEndpoints = await db
    .select({ id: endpoints.id })
    .from(endpoints)
    .where(eq(endpoints.channelInstanceId, instanceId));

  for (const ep of relatedEndpoints) {
    await db.delete(sessions).where(eq(sessions.endpointId, ep.id));
    await db.delete(endpoints).where(eq(endpoints.id, ep.id));
  }

  await db.delete(channelInstances).where(eq(channelInstances.id, instanceId));

  return c.json({ success: true });
});

/** GET /endpoints — List configured endpoints. */
channelsHandlers.get('/endpoints', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const rows = await db
    .select()
    .from(endpoints)
    .orderBy(desc(endpoints.createdAt));

  return c.json(rows);
});

/** POST /endpoints — Create an endpoint. */
channelsHandlers.post('/endpoints', async (c) => {
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
      channelInstanceId: body.channelInstanceId,
      agentId: body.agentId,
      assignmentPattern: body.assignmentPattern,
      config: body.config ?? {},
    })
    .returning();

  return c.json(row, 201);
});

/** PATCH /endpoints/:id — Update an endpoint. */
channelsHandlers.patch('/endpoints/:id', async (c) => {
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
      ...(body.channelInstanceId !== undefined && {
        channelInstanceId: body.channelInstanceId,
      }),
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

/** POST /outbox/:id/retry — Retry a failed outbox message. */
channelsHandlers.post('/outbox/:id/retry', async (c) => {
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
