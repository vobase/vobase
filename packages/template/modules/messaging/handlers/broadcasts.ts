import {
  getCtx,
  notFound,
  requireRole,
  unauthorized,
  validation,
} from '@vobase/core';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  audienceFilterSchema,
  buildAudienceWhereWithLabels,
} from '../lib/audience-filter';
import { parseAndCreateRecipients } from '../lib/broadcast-csv';
import { getModuleDeps } from '../lib/deps';
import { broadcastRecipients, broadcasts, contacts } from '../schema';

// ─── Schemas ────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const recipientsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z
    .enum(['queued', 'sent', 'delivered', 'read', 'failed', 'skipped'])
    .optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  channelInstanceId: z.string().min(1),
  templateId: z.string().min(1),
  templateName: z.string().min(1),
  templateLanguage: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
  templateName: z.string().min(1).optional(),
  templateLanguage: z.string().optional(),
  variableMapping: z.record(z.string(), z.string()).optional(),
  scheduledAt: z.string().datetime().optional(),
  timezone: z.string().optional(),
});

const uploadRecipientsSchema = z.object({
  csvText: z.string().min(1),
  variableMapping: z.record(z.string(), z.string()),
  saveAsLabel: z.string().optional(),
});

const scheduleSchema = z.object({
  scheduledAt: z.string().datetime(),
  timezone: z.string().optional(),
});

// ─── Handlers ───────────────────────────────────────────────────────

export const broadcastsHandlers = new Hono()
  .use('*', requireRole('admin'))
  // GET / — list broadcasts with pagination
  .get('/', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const parsed = listQuerySchema.safeParse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors);
    }
    const { limit, offset } = parsed.data;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(broadcasts)
        .orderBy(desc(broadcasts.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(broadcasts),
    ]);

    return c.json({ data: rows, total });
  })
  // GET /:id — single broadcast
  .get('/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [row] = await db
      .select()
      .from(broadcasts)
      .where(eq(broadcasts.id, id));

    if (!row) throw notFound('Broadcast not found');

    return c.json(row);
  })
  // GET /:id/recipients — paginated recipient list
  .get('/:id/recipients', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const parsed = recipientsQuerySchema.safeParse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
      status: c.req.query('status'),
    });
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors);
    }
    const { limit, offset, status } = parsed.data;

    const condition = status
      ? and(
          eq(broadcastRecipients.broadcastId, id),
          eq(broadcastRecipients.status, status),
        )
      : eq(broadcastRecipients.broadcastId, id);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(broadcastRecipients)
        .where(condition)
        .orderBy(desc(broadcastRecipients.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(broadcastRecipients).where(condition),
    ]);

    return c.json({ data: rows, total });
  })
  // POST / — create draft broadcast
  .post('/', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = await c.req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors);
    }
    const data = parsed.data;

    const [row] = await db
      .insert(broadcasts)
      .values({
        name: data.name,
        channelInstanceId: data.channelInstanceId,
        templateId: data.templateId,
        templateName: data.templateName,
        templateLanguage: data.templateLanguage ?? 'en',
        status: 'draft',
        createdBy: user.id,
      })
      .returning();

    return c.json(row, 201);
  })
  // PUT /:id — update draft broadcast
  .put('/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const body = await c.req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors);
    }
    const data = parsed.data;

    const [existing] = await db
      .select({ id: broadcasts.id, status: broadcasts.status })
      .from(broadcasts)
      .where(eq(broadcasts.id, id));

    if (!existing) throw notFound('Broadcast not found');

    if (existing.status !== 'draft') {
      throw validation({
        status: 'Broadcast can only be updated when in draft status',
      });
    }

    const [row] = await db
      .update(broadcasts)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.templateId !== undefined && { templateId: data.templateId }),
        ...(data.templateName !== undefined && {
          templateName: data.templateName,
        }),
        ...(data.templateLanguage !== undefined && {
          templateLanguage: data.templateLanguage,
        }),
        ...(data.variableMapping !== undefined && {
          variableMapping: data.variableMapping,
        }),
        ...(data.scheduledAt !== undefined && {
          scheduledAt: new Date(data.scheduledAt),
        }),
        ...(data.timezone !== undefined && { timezone: data.timezone }),
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, id))
      .returning();

    return c.json(row);
  })
  // POST /:id/recipients — upload CSV and create recipients
  .post('/:id/recipients', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [existing] = await db
      .select({ id: broadcasts.id })
      .from(broadcasts)
      .where(eq(broadcasts.id, id));

    if (!existing) throw notFound('Broadcast not found');

    const contentType = c.req.header('content-type') ?? '';

    let csvText: string;
    let variableMapping: Record<string, string>;
    let saveAsLabel: string | undefined;

    if (contentType.includes('application/json')) {
      const body = await c.req.json();
      const parsed = uploadRecipientsSchema.safeParse(body);
      if (!parsed.success) {
        throw validation(parsed.error.flatten().fieldErrors);
      }
      csvText = parsed.data.csvText;
      variableMapping = parsed.data.variableMapping;
      saveAsLabel = parsed.data.saveAsLabel;
    } else {
      // Plain text CSV body
      csvText = await c.req.text();
      variableMapping = {};
    }

    const summary = await parseAndCreateRecipients(
      db,
      id,
      csvText,
      variableMapping,
      {
        saveAsLabel,
      },
    );

    return c.json(summary);
  })
  // POST /:id/send — trigger immediate send
  .post('/:id/send', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');
    const deps = getModuleDeps();

    // Atomic status transition — prevents race conditions from double-clicks
    const [updated] = await db
      .update(broadcasts)
      .set({ status: 'sending', startedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(broadcasts.id, id),
          inArray(broadcasts.status, ['draft', 'scheduled']),
        ),
      )
      .returning({ id: broadcasts.id });

    if (!updated) {
      const [existing] = await db
        .select({ id: broadcasts.id })
        .from(broadcasts)
        .where(eq(broadcasts.id, id));
      if (!existing) throw notFound('Broadcast not found');
      throw validation({
        status: 'Broadcast must be in draft or scheduled status to send',
      });
    }

    await deps.scheduler.add(
      'broadcast:execute',
      { broadcastId: id },
      { singletonKey: id },
    );

    return c.json({ ok: true });
  })
  // POST /:id/schedule — schedule for later
  .post('/:id/schedule', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const body = await c.req.json();
    const parsed = scheduleSchema.safeParse(body);
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors);
    }
    const data = parsed.data;

    const [existing] = await db
      .select({ id: broadcasts.id, status: broadcasts.status })
      .from(broadcasts)
      .where(eq(broadcasts.id, id));

    if (!existing) throw notFound('Broadcast not found');

    if (existing.status !== 'draft') {
      throw validation({
        status: 'Broadcast must be in draft status to schedule',
      });
    }

    const [row] = await db
      .update(broadcasts)
      .set({
        status: 'scheduled',
        scheduledAt: new Date(data.scheduledAt),
        ...(data.timezone !== undefined && { timezone: data.timezone }),
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, id))
      .returning();

    return c.json(row);
  })
  // POST /:id/cancel — cancel scheduled or pause sending
  .post('/:id/cancel', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [existing] = await db
      .select({ id: broadcasts.id, status: broadcasts.status })
      .from(broadcasts)
      .where(eq(broadcasts.id, id));

    if (!existing) throw notFound('Broadcast not found');

    if (existing.status !== 'scheduled' && existing.status !== 'sending') {
      throw validation({
        status: 'Broadcast must be scheduled or sending to cancel/pause',
      });
    }

    const newStatus = existing.status === 'scheduled' ? 'cancelled' : 'paused';

    await db
      .update(broadcasts)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(broadcasts.id, id));

    return c.json({ ok: true });
  })
  // POST /:id/retry-failed — retry failed recipients
  .post('/:id/retry-failed', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');
    const deps = getModuleDeps();

    const [existing] = await db
      .select({ id: broadcasts.id })
      .from(broadcasts)
      .where(eq(broadcasts.id, id));

    if (!existing) throw notFound('Broadcast not found');

    // Reset failed recipients to queued
    const resetRows = await db
      .update(broadcastRecipients)
      .set({ status: 'queued', failureReason: null })
      .where(
        and(
          eq(broadcastRecipients.broadcastId, id),
          eq(broadcastRecipients.status, 'failed'),
        ),
      )
      .returning({ id: broadcastRecipients.id });

    const retryCount = resetRows.length;

    // Recalculate failedCount and set status to sending
    const [{ remaining }] = await db
      .select({ remaining: count() })
      .from(broadcastRecipients)
      .where(
        and(
          eq(broadcastRecipients.broadcastId, id),
          eq(broadcastRecipients.status, 'failed'),
        ),
      );

    await db
      .update(broadcasts)
      .set({
        status: 'sending',
        failedCount: remaining,
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, id));

    await deps.scheduler.add(
      'broadcast:execute',
      { broadcastId: id },
      { singletonKey: id },
    );

    return c.json({ ok: true, retryCount });
  })
  // POST /:id/audience-preview — preview matching contacts for filter criteria
  .post('/:id/audience-preview', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = await c.req.json();
    const parsed = audienceFilterSchema.safeParse(body);
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors);
    }
    const filter = parsed.data;
    const fullWhere = buildAudienceWhereWithLabels(db, filter);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: contacts.id,
          name: contacts.name,
          phone: contacts.phone,
          role: contacts.role,
        })
        .from(contacts)
        .where(fullWhere)
        .limit(10),
      db.select({ total: count() }).from(contacts).where(fullWhere),
    ]);

    return c.json({ total, sample: rows });
  })
  // POST /:id/audience-add — add recipients from filter criteria
  .post('/:id/audience-add', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [existing] = await db
      .select({ id: broadcasts.id, status: broadcasts.status })
      .from(broadcasts)
      .where(eq(broadcasts.id, id));

    if (!existing) throw notFound('Broadcast not found');
    if (existing.status !== 'draft') {
      throw validation({
        status: 'Broadcast must be in draft status to add recipients',
      });
    }

    const body = await c.req.json();
    const parsed = audienceFilterSchema.safeParse(body);
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors);
    }
    const filter = parsed.data;
    const fullWhere = buildAudienceWhereWithLabels(db, filter);

    // Fetch all matching contacts with phone numbers
    const matchingContacts = await db
      .select({
        id: contacts.id,
        phone: contacts.phone,
      })
      .from(contacts)
      .where(fullWhere);

    if (matchingContacts.length === 0) {
      return c.json({ added: 0, skipped: 0 });
    }

    // Batch insert recipients, skip duplicates
    const rows = matchingContacts
      .filter((c) => c.phone)
      .map((c) => ({
        broadcastId: id,
        contactId: c.id,
        phone: c.phone!,
        variables: {},
      }));

    const skipped = matchingContacts.length - rows.length;
    let added = 0;

    if (rows.length > 0) {
      const inserted = await db
        .insert(broadcastRecipients)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: broadcastRecipients.id });
      added = inserted.length;
    }

    // Update total recipients count
    const [{ total }] = await db
      .select({ total: count() })
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.broadcastId, id));

    await db
      .update(broadcasts)
      .set({ totalRecipients: total, updatedAt: new Date() })
      .where(eq(broadcasts.id, id));

    return c.json({ added, skipped, total });
  })
  // DELETE /:id — delete draft or cancelled broadcast
  .delete('/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [existing] = await db
      .select({ id: broadcasts.id, status: broadcasts.status })
      .from(broadcasts)
      .where(eq(broadcasts.id, id));

    if (!existing) throw notFound('Broadcast not found');

    if (existing.status !== 'draft' && existing.status !== 'cancelled') {
      throw validation({
        status: 'Broadcast can only be deleted when draft or cancelled',
      });
    }

    // broadcastRecipients have onDelete cascade — deleting the broadcast removes them
    await db.delete(broadcasts).where(eq(broadcasts.id, id));

    return c.json({ ok: true });
  });
