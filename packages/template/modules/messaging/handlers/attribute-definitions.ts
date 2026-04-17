import { getCtx, notFound, unauthorized, validation } from '@vobase/core';
import { asc, eq, max } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { requireAdmin } from '../../lib/require-admin';
import { contactAttributeDefinitions } from '../schema';

// ─── Schemas ────────────────────────────────────────────────────────

const createSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'Key must be lowercase alphanumeric starting with a letter',
    ),
  label: z.string().min(1),
  type: z.enum(['text', 'number', 'boolean', 'date']).default('text'),
  showInTable: z.boolean().default(false),
});

const updateSchema = z.object({
  label: z.string().min(1).optional(),
  type: z.enum(['text', 'number', 'boolean', 'date']).optional(),
  showInTable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// ─── Handlers ───────────────────────────────────────────────────────

export const attributeDefinitionsHandlers = new Hono()
  .use('*', requireAdmin())
  /** GET / — List all attribute definitions, ordered by sortOrder. */
  .get('/', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rows = await db
      .select()
      .from(contactAttributeDefinitions)
      .orderBy(asc(contactAttributeDefinitions.sortOrder));

    return c.json({ data: rows });
  })

  /** POST / — Create a new attribute definition. */
  .post('/', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = await c.req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);

    const data = parsed.data;

    // Get next sort order via aggregate
    const [{ maxOrder }] = await db
      .select({ maxOrder: max(contactAttributeDefinitions.sortOrder) })
      .from(contactAttributeDefinitions);
    const nextOrder = maxOrder != null ? maxOrder + 1 : 0;

    const [row] = await db
      .insert(contactAttributeDefinitions)
      .values({
        key: data.key,
        label: data.label,
        type: data.type,
        showInTable: data.showInTable,
        sortOrder: nextOrder,
      })
      .returning();

    return c.json(row, 201);
  })

  /** PUT /:id — Update an attribute definition. */
  .put('/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const body = await c.req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);

    const data = parsed.data;

    const [existing] = await db
      .select({ id: contactAttributeDefinitions.id })
      .from(contactAttributeDefinitions)
      .where(eq(contactAttributeDefinitions.id, id));

    if (!existing) throw notFound('Attribute definition not found');

    const [row] = await db
      .update(contactAttributeDefinitions)
      .set({
        ...(data.label !== undefined && { label: data.label }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.showInTable !== undefined && {
          showInTable: data.showInTable,
        }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      })
      .where(eq(contactAttributeDefinitions.id, id))
      .returning();

    return c.json(row);
  })

  /** DELETE /:id — Delete an attribute definition. */
  .delete('/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [existing] = await db
      .select({ id: contactAttributeDefinitions.id })
      .from(contactAttributeDefinitions)
      .where(eq(contactAttributeDefinitions.id, id));

    if (!existing) throw notFound('Attribute definition not found');

    await db
      .delete(contactAttributeDefinitions)
      .where(eq(contactAttributeDefinitions.id, id));

    return c.json({ ok: true });
  });
