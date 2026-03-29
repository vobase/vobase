import { getCtx, notFound, unauthorized, validation } from '@vobase/core';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
} from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { dataTableConfig } from '@/config/data-table';
import { filterColumns } from '@/lib/filter-columns';
import { contacts } from '../schema';

// ─── Schemas ────────────────────────────────────────────────────────

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

const sortItemSchema = z.object({
  id: z.enum(['name', 'email', 'role', 'createdAt', 'updatedAt']),
  desc: z.boolean(),
});

const filterItemSchema = z.object({
  id: z.string(),
  value: z.union([z.string(), z.array(z.string())]),
  variant: z.enum(dataTableConfig.filterVariants),
  operator: z.enum(dataTableConfig.operators),
  filterId: z.string(),
});

const tableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(10),
  sort: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return [];
      try {
        const parsed = JSON.parse(val);
        return z.array(sortItemSchema).parse(parsed);
      } catch {
        return [];
      }
    }),
  filters: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return [];
      try {
        const parsed = JSON.parse(val);
        return z.array(filterItemSchema).parse(parsed);
      } catch {
        return [];
      }
    }),
  joinOperator: z.enum(['and', 'or']).default('and'),
  // Simple column filters (from useDataTable basic mode)
  name: z.string().optional(),
  role: z.string().optional(),
  createdAt: z.string().optional(),
});

// ─── Column mapping for sorting ─────────────────────────────────────

const sortColumns = {
  name: contacts.name,
  email: contacts.email,
  role: contacts.role,
  createdAt: contacts.createdAt,
  updatedAt: contacts.updatedAt,
} as const;

// ─── Handlers ───────────────────────────────────────────────────────

export const contactsHandlers = new Hono()
  // GET / — simple list with pagination + optional search (kept for API compatibility)
  .get('/', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

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
  // GET /table — server-side filtered, sorted, paginated for data-table
  .get('/table', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const parsed = tableQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors);
    }

    const {
      page,
      perPage,
      sort,
      filters,
      joinOperator,
      name: search,
      role,
      createdAt,
    } = parsed.data;
    const offset = (page - 1) * perPage;

    // Build WHERE from advanced filters (FilterList) OR simple column filters (Toolbar)
    let where: ReturnType<typeof filterColumns> | undefined;
    if (filters.length > 0) {
      where = filterColumns({
        table: contacts,
        filters: filters as Parameters<
          typeof filterColumns<typeof contacts>
        >[0]['filters'],
        joinOperator,
      });
    } else {
      // Simple column filters from DataTableToolbar
      const conditions = [];

      // Universal search across name, email, and phone
      if (search) {
        conditions.push(
          or(
            ilike(contacts.name, `%${search}%`),
            ilike(contacts.email, `%${search}%`),
            ilike(contacts.phone, `%${search}%`),
          ),
        );
      }

      if (role) {
        const roles = role.split(',').filter(Boolean);
        if (roles.length > 0) {
          conditions.push(
            roles.length === 1
              ? eq(contacts.role, roles[0])
              : inArray(contacts.role, roles),
          );
        }
      }

      // Date range filter: "from,to" as epoch milliseconds
      if (createdAt) {
        const parts = createdAt.split(',').map(Number).filter(Boolean);
        if (parts.length === 2) {
          conditions.push(
            and(
              gte(contacts.createdAt, new Date(parts[0])),
              lte(contacts.createdAt, new Date(parts[1])),
            ),
          );
        } else if (parts.length === 1) {
          // Single timestamp: treat as "on this day" (start of day to end of day)
          const day = new Date(parts[0]);
          const start = new Date(day);
          start.setHours(0, 0, 0, 0);
          const end = new Date(day);
          end.setHours(23, 59, 59, 999);
          conditions.push(
            and(gte(contacts.createdAt, start), lte(contacts.createdAt, end)),
          );
        }
      }

      where = conditions.length > 0 ? and(...conditions) : undefined;
    }

    // Build ORDER BY
    const orderBy =
      sort.length > 0
        ? sort.map((s) => {
            const col = sortColumns[s.id as keyof typeof sortColumns];
            return s.desc ? desc(col) : asc(col);
          })
        : [desc(contacts.createdAt)];

    // Execute data + count in parallel
    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(contacts)
        .where(where)
        .orderBy(...orderBy)
        .limit(perPage)
        .offset(offset),
      db.select({ total: count() }).from(contacts).where(where),
    ]);

    return c.json({
      data: rows,
      pageCount: Math.ceil(total / perPage),
    });
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
