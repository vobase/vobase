import {
  conflict,
  getCtx,
  notFound,
  unauthorized,
  validation,
} from '@vobase/core';
import { and, count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getAgent } from '../../../mastra/agents';
import {
  channelInstances,
  channelRoutings,
  conversations,
  outbox,
} from '../schema';

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

export const channelsHandlers = new Hono()
  /** GET /instances — List all channel instances. */
  .get('/instances', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rows = await db
      .select()
      .from(channelInstances)
      .orderBy(desc(channelInstances.createdAt));

    return c.json(rows);
  })
  /** GET /instances/:id — Get a single channel instance. */
  .get('/instances/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const [row] = await db
      .select()
      .from(channelInstances)
      .where(eq(channelInstances.id, c.req.param('id')));

    if (!row) throw notFound('Channel instance not found');

    return c.json(row);
  })
  /** POST /instances — Create a channel instance. */
  .post('/instances', async (c) => {
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
  })
  /** PATCH /instances/:id — Update a channel instance. */
  .patch('/instances/:id', async (c) => {
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
  })
  /** DELETE /instances/:id — Delete a channel instance. */
  .delete('/instances/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const instanceId = c.req.param('id');

    const [existing] = await db
      .select()
      .from(channelInstances)
      .where(eq(channelInstances.id, instanceId));

    if (!existing) throw notFound('Channel instance not found');

    // M8: Prevent deletion if active conversations exist on channel routings bound to this instance
    const activeConversations = await db
      .select({ id: conversations.id })
      .from(conversations)
      .innerJoin(
        channelRoutings,
        eq(conversations.channelRoutingId, channelRoutings.id),
      )
      .where(
        and(
          eq(channelRoutings.channelInstanceId, instanceId),
          eq(conversations.status, 'active'),
        ),
      )
      .limit(1);

    if (activeConversations.length > 0) {
      throw conflict(
        'Cannot delete channel instance with active conversations',
      );
    }

    // Clean up completed conversations and channel routings before deleting instance (FK safety)
    const relatedRoutings = await db
      .select({ id: channelRoutings.id })
      .from(channelRoutings)
      .where(eq(channelRoutings.channelInstanceId, instanceId));

    for (const ep of relatedRoutings) {
      await db
        .delete(conversations)
        .where(eq(conversations.channelRoutingId, ep.id));
      await db.delete(channelRoutings).where(eq(channelRoutings.id, ep.id));
    }

    await db
      .delete(channelInstances)
      .where(eq(channelInstances.id, instanceId));

    return c.json({ success: true });
  })
  /** GET /endpoints — List configured channel routings. */
  .get('/channel-routings', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rows = await db
      .select()
      .from(channelRoutings)
      .orderBy(desc(channelRoutings.createdAt));

    return c.json(rows);
  })
  /** POST /endpoints — Create a channel routing. */
  .post('/channel-routings', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = createEndpointSchema.parse(await c.req.json());

    // Validate agent exists
    const registered = getAgent(body.agentId);
    if (!registered)
      throw validation({ agentId: `Agent '${body.agentId}' not found` });

    const [row] = await db
      .insert(channelRoutings)
      .values({
        name: body.name,
        channelInstanceId: body.channelInstanceId,
        agentId: body.agentId,
        assignmentPattern: body.assignmentPattern,
        config: body.config ?? {},
      })
      .returning();

    return c.json(row, 201);
  })
  /** PATCH /endpoints/:id — Update a channel routing. */
  .patch('/channel-routings/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = updateEndpointSchema.parse(await c.req.json());
    const channelRoutingId = c.req.param('id');

    const [existing] = await db
      .select()
      .from(channelRoutings)
      .where(eq(channelRoutings.id, channelRoutingId));

    if (!existing) throw notFound('Channel routing not found');

    const [row] = await db
      .update(channelRoutings)
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
      .where(eq(channelRoutings.id, channelRoutingId))
      .returning();

    return c.json(row);
  })
  /** GET /channels/status — List channel instances with active conversation counts. */
  .get('/channels/status', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    // Two queries to avoid correlated subquery issues with Drizzle SQL templates
    const instances = await db
      .select()
      .from(channelInstances)
      .orderBy(channelInstances.type);

    const conversationCounts = await db
      .select({
        channelInstanceId: conversations.channelInstanceId,
        count: count(),
      })
      .from(conversations)
      .where(eq(conversations.status, 'active'))
      .groupBy(conversations.channelInstanceId);

    const countMap = new Map(
      conversationCounts.map((r) => [r.channelInstanceId, Number(r.count)]),
    );

    const channels = instances.map((inst) => ({
      id: inst.id,
      type: inst.type,
      label: inst.label,
      status: inst.status,
      activeSessionCount: countMap.get(inst.id) ?? 0,
    }));

    return c.json({ channels });
  })
  /** POST /outbox/:id/retry — Retry a failed outbox message. */
  .post('/outbox/:id/retry', async (c) => {
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

    await scheduler.add('ai:send', { outboxId });

    const [updated] = await db
      .select()
      .from(outbox)
      .where(eq(outbox.id, outboxId));

    return c.json(updated);
  });
