import { getCtx, unauthorized } from '@vobase/core';
import { and, desc, eq, gte, like, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { activityEvents } from '../schema';

const activityFilterSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  agentId: z.string().optional(),
  category: z.string().optional(),
  type: z.string().optional(),
  channelType: z.string().optional(),
  contactId: z.string().optional(),
  conversationId: z.string().optional(),
  timeFrom: z.string().optional(),
  timeTo: z.string().optional(),
  resolutionStatus: z.enum(['pending', 'reviewed', 'dismissed']).optional(),
});

const cursorSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
});

export const activityHandlers = new Hono().get('/activity', async (c) => {
  const { db, user } = getCtx(c);
  if (!user) throw unauthorized();

  const params = activityFilterSchema.parse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  const conditions = [];

  if (params.agentId)
    conditions.push(eq(activityEvents.agentId, params.agentId));
  if (params.category)
    conditions.push(like(activityEvents.type, `${params.category}.%`));
  if (params.type) conditions.push(eq(activityEvents.type, params.type));
  if (params.channelType)
    conditions.push(eq(activityEvents.channelType, params.channelType));
  if (params.contactId)
    conditions.push(eq(activityEvents.contactId, params.contactId));
  if (params.conversationId)
    conditions.push(eq(activityEvents.conversationId, params.conversationId));
  if (params.resolutionStatus)
    conditions.push(
      eq(activityEvents.resolutionStatus, params.resolutionStatus),
    );
  if (params.timeFrom)
    conditions.push(gte(activityEvents.createdAt, new Date(params.timeFrom)));
  if (params.timeTo)
    conditions.push(lte(activityEvents.createdAt, new Date(params.timeTo)));

  // Cursor-based pagination
  if (params.cursor) {
    try {
      const decoded = JSON.parse(atob(params.cursor));
      const cursor = cursorSchema.parse(decoded);
      conditions.push(
        sql`(${activityEvents.createdAt}, ${activityEvents.id}) < (${new Date(cursor.createdAt)}, ${cursor.id})`,
      );
    } catch {
      // Invalid cursor — ignore, return from beginning
    }
  }

  const rows = await db
    .select()
    .from(activityEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const events = hasMore ? rows.slice(0, params.limit) : rows;
  const nextCursor =
    hasMore && events.length > 0
      ? btoa(
          JSON.stringify({
            createdAt: events[events.length - 1].createdAt.toISOString(),
            id: events[events.length - 1].id,
          }),
        )
      : null;

  return c.json({ events, nextCursor });
});
