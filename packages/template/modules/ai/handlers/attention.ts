import { conflict, getCtx, notFound, unauthorized } from '@vobase/core';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { getModuleDeps } from '../lib/deps';
import { createActivityMessage } from '../lib/messages';
import { messages } from '../schema';

export const attentionHandlers = new Hono()
  .get('/attention', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.messageType, 'activity'),
          eq(messages.resolutionStatus, 'pending'),
          sql`${messages.contentData}->>'eventType' IN ('escalation.created', 'guardrail.block')`,
        ),
      )
      .orderBy(asc(messages.createdAt));

    return c.json({ items: rows, count: rows.length });
  })
  .post('/attention/:eventId/review', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const eventId = c.req.param('eventId');
    const { realtime } = getModuleDeps();

    const updated = await db
      .update(messages)
      .set({ resolutionStatus: 'reviewed' })
      .where(
        and(eq(messages.id, eventId), eq(messages.resolutionStatus, 'pending')),
      )
      .returning();

    if (updated.length === 0) {
      const [exists] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.id, eventId));
      if (!exists) throw notFound('Event not found');
      throw conflict('Event already reviewed or dismissed');
    }

    const row = updated[0];
    const contentData = (row.contentData ?? {}) as Record<string, unknown>;
    await createActivityMessage(db, realtime, {
      interactionId: row.interactionId,
      eventType: 'attention.reviewed',
      actor: user.id,
      actorType: 'user',
      data: { eventId, originalType: contentData.eventType },
    });
    await realtime.notify({
      table: 'interactions-dashboard',
      action: 'update',
    });

    return c.json(row);
  })
  .post('/attention/:eventId/dismiss', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const eventId = c.req.param('eventId');
    const { realtime } = getModuleDeps();

    const updated = await db
      .update(messages)
      .set({ resolutionStatus: 'dismissed' })
      .where(
        and(eq(messages.id, eventId), eq(messages.resolutionStatus, 'pending')),
      )
      .returning();

    if (updated.length === 0) {
      const [exists] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.id, eventId));
      if (!exists) throw notFound('Event not found');
      throw conflict('Event already reviewed or dismissed');
    }

    const row = updated[0];
    const contentData = (row.contentData ?? {}) as Record<string, unknown>;
    await createActivityMessage(db, realtime, {
      interactionId: row.interactionId,
      eventType: 'attention.dismissed',
      actor: user.id,
      actorType: 'user',
      data: { eventId, originalType: contentData.eventType },
    });
    await realtime.notify({
      table: 'interactions-dashboard',
      action: 'update',
    });

    return c.json(row);
  });
