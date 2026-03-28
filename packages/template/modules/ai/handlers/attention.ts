import { conflict, getCtx, notFound, unauthorized } from '@vobase/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';

import { emitActivityEvent } from '../lib/activity-events';
import { getModuleDeps } from '../lib/deps';
import { activityEvents } from '../schema';

export const attentionHandlers = new Hono()
  .get('/attention', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rows = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          inArray(activityEvents.type, [
            'escalation.created',
            'guardrail.block',
          ]),
          eq(activityEvents.resolutionStatus, 'pending'),
        ),
      )
      .orderBy(asc(activityEvents.createdAt));

    return c.json({ items: rows, count: rows.length });
  })
  .post('/attention/:eventId/review', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const eventId = c.req.param('eventId');
    const { realtime } = getModuleDeps();

    const updated = await db
      .update(activityEvents)
      .set({ resolutionStatus: 'reviewed' })
      .where(
        and(
          eq(activityEvents.id, eventId),
          eq(activityEvents.resolutionStatus, 'pending'),
        ),
      )
      .returning();

    if (updated.length === 0) {
      // Check if event exists
      const [exists] = await db
        .select({ id: activityEvents.id })
        .from(activityEvents)
        .where(eq(activityEvents.id, eventId));
      if (!exists) throw notFound('Event not found');
      throw conflict('Event already reviewed or dismissed');
    }

    await emitActivityEvent(db, realtime, {
      type: 'attention.reviewed',
      userId: user.id,
      source: 'staff',
      conversationId: updated[0].conversationId ?? undefined,
      data: { eventId, originalType: updated[0].type },
    });
    await realtime.notify({
      table: 'conversations-dashboard',
      action: 'update',
    });

    return c.json(updated[0]);
  })
  .post('/attention/:eventId/dismiss', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const eventId = c.req.param('eventId');
    const { realtime } = getModuleDeps();

    const updated = await db
      .update(activityEvents)
      .set({ resolutionStatus: 'dismissed' })
      .where(
        and(
          eq(activityEvents.id, eventId),
          eq(activityEvents.resolutionStatus, 'pending'),
        ),
      )
      .returning();

    if (updated.length === 0) {
      const [exists] = await db
        .select({ id: activityEvents.id })
        .from(activityEvents)
        .where(eq(activityEvents.id, eventId));
      if (!exists) throw notFound('Event not found');
      throw conflict('Event already reviewed or dismissed');
    }

    await emitActivityEvent(db, realtime, {
      type: 'attention.dismissed',
      userId: user.id,
      source: 'staff',
      conversationId: updated[0].conversationId ?? undefined,
      data: { eventId, originalType: updated[0].type },
    });
    await realtime.notify({
      table: 'conversations-dashboard',
      action: 'update',
    });

    return c.json(updated[0]);
  });
