import { getCtx, notFound, validation } from '@vobase/core';
import { count, eq, ilike, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { contacts } from '../../contacts/schema';

const createSchema = z
  .object({
    phone: z.string().optional(),
    email: z.string().optional(),
    name: z.string().optional(),
    identifier: z.string().optional(),
    role: z.enum(['customer', 'lead', 'staff']).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => d.phone !== undefined || d.email !== undefined, {
    message: 'At least phone or email is required',
  });

const updateSchema = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  identifier: z.string().optional(),
  role: z.enum(['customer', 'lead', 'staff']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
});

export const contactsHandlers = new Hono()
  // GET / — list contacts with pagination + optional search
  .get('/', async (c) => {
    const { db } = getCtx(c);

    const parsed = listQuerySchema.safeParse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
      search: c.req.query('search'),
    });
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors);
    }
    const { limit, offset, search } = parsed.data;

    const condition = search
      ? or(
          ilike(contacts.phone, `%${search}%`),
          ilike(contacts.email, `%${search}%`),
          ilike(contacts.name, `%${search}%`),
        )
      : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db.select().from(contacts).where(condition).limit(limit).offset(offset),
      db.select({ total: count() }).from(contacts).where(condition),
    ]);

    return c.json({ data: rows, total });
  })
  // GET /search — exact match by phone or email (for staff routing)
  .get('/search', async (c) => {
    const { db } = getCtx(c);

    const phone = c.req.query('phone');
    const email = c.req.query('email');

    if (!phone && !email) {
      throw validation({ query: 'phone or email required' });
    }

    const conditions = [];
    if (phone) conditions.push(eq(contacts.phone, phone));
    if (email) conditions.push(eq(contacts.email, email));

    const rows = await db
      .select()
      .from(contacts)
      .where(or(...conditions));

    return c.json(rows);
  })
  // GET /:id — get single contact
  .get('/:id', async (c) => {
    const { db } = getCtx(c);
    const id = c.req.param('id');

    const [row] = await db.select().from(contacts).where(eq(contacts.id, id));

    if (!row) throw notFound('Contact not found');

    return c.json(row);
  })
  // POST / — create contact
  .post('/', async (c) => {
    const { db } = getCtx(c);

    const body = await c.req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors);
    }

    const data = parsed.data;

    const [row] = await db
      .insert(contacts)
      .values({
        phone: data.phone,
        email: data.email,
        name: data.name,
        identifier: data.identifier,
        role: data.role ?? 'customer',
        metadata: data.metadata ?? {},
      })
      .returning();

    return c.json(row, 201);
  })
  // PATCH /:id — update contact
  .patch('/:id', async (c) => {
    const { db } = getCtx(c);
    const id = c.req.param('id');

    const body = await c.req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors);
    }

    const data = parsed.data;

    const [existing] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, id));

    if (!existing) throw notFound('Contact not found');

    const [row] = await db
      .update(contacts)
      .set({
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.name !== undefined && { name: data.name }),
        ...(data.identifier !== undefined && { identifier: data.identifier }),
        ...(data.role !== undefined && { role: data.role }),
        ...(data.metadata !== undefined && { metadata: data.metadata }),
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, id))
      .returning();

    return c.json(row);
  });
