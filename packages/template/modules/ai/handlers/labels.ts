import { getCtx, unauthorized } from '@vobase/core';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getModuleDeps } from '../lib/deps';
import { createActivityMessage } from '../lib/messages';
import { interactionLabels, labels } from '../schema';

const createLabelSchema = z.object({
  title: z.string().min(1).max(100),
  color: z.string().max(20).optional(),
  description: z.string().max(500).optional(),
});

const updateLabelSchema = createLabelSchema.partial();

const addLabelsSchema = z.object({
  labelIds: z.array(z.string().min(1)),
});

export const labelsHandlers = new Hono()
  // Labels CRUD
  .get('/labels', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();
    const rows = await db.select().from(labels);
    return c.json(rows);
  })
  .post('/labels', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();
    const body = createLabelSchema.parse(await c.req.json());
    const [label] = await db.insert(labels).values(body).returning();
    return c.json(label, 201);
  })
  .patch('/labels/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();
    const body = updateLabelSchema.parse(await c.req.json());
    const [label] = await db
      .update(labels)
      .set(body)
      .where(eq(labels.id, c.req.param('id')))
      .returning();
    if (!label) return c.json({ error: 'Not found' }, 404);
    return c.json(label);
  })
  .delete('/labels/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();
    const [deleted] = await db
      .delete(labels)
      .where(eq(labels.id, c.req.param('id')))
      .returning();
    if (!deleted) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  })
  // Interaction labels
  .get('/interactions/:id/labels', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();
    const rows = await db
      .select({ label: labels })
      .from(interactionLabels)
      .innerJoin(labels, eq(interactionLabels.labelId, labels.id))
      .where(eq(interactionLabels.interactionId, c.req.param('id')));
    return c.json(rows.map((r) => r.label));
  })
  .post('/interactions/:id/labels', async (c) => {
    const { db, user } = getCtx(c);
    const interactionId = c.req.param('id');
    const { labelIds } = addLabelsSchema.parse(await c.req.json());
    const values = labelIds.map((labelId) => ({
      interactionId,
      labelId,
    }));
    await db.insert(interactionLabels).values(values).onConflictDoNothing();

    // Record activity + notify for each label added
    const { realtime } = getModuleDeps();
    const addedLabels = await db
      .select({ id: labels.id, title: labels.title })
      .from(labels)
      .where(inArray(labels.id, labelIds));
    const labelMap = new Map(addedLabels.map((l) => [l.id, l.title]));

    for (const labelId of labelIds) {
      await createActivityMessage(db, realtime, {
        interactionId,
        eventType: 'label.added',
        actor: user?.id,
        actorType: 'user',
        data: { labelId, labelTitle: labelMap.get(labelId) ?? labelId },
      });
    }

    await realtime
      .notify({
        table: 'interaction-labels',
        id: interactionId,
        action: 'insert',
      })
      .catch(() => {});
    await realtime
      .notify({ table: 'interactions', id: interactionId, action: 'update' })
      .catch(() => {});

    return c.json({ ok: true });
  })
  .delete('/interactions/:id/labels/:lid', async (c) => {
    const { db, user } = getCtx(c);
    const interactionId = c.req.param('id');
    const labelId = c.req.param('lid');

    // Get label title before deletion for the activity message
    const [label] = await db
      .select({ title: labels.title })
      .from(labels)
      .where(eq(labels.id, labelId));

    await db
      .delete(interactionLabels)
      .where(
        and(
          eq(interactionLabels.interactionId, interactionId),
          eq(interactionLabels.labelId, labelId),
        ),
      );

    const { realtime } = getModuleDeps();
    await createActivityMessage(db, realtime, {
      interactionId,
      eventType: 'label.removed',
      actor: user?.id,
      actorType: 'user',
      data: { labelId, labelTitle: label?.title ?? labelId },
    });

    await realtime
      .notify({
        table: 'interaction-labels',
        id: interactionId,
        action: 'delete',
      })
      .catch(() => {});
    await realtime
      .notify({ table: 'interactions', id: interactionId, action: 'update' })
      .catch(() => {});

    return c.json({ ok: true });
  });
