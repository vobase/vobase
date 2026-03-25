import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { errorHandler } from '@vobase/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { createTestDb } from '../../lib/test-helpers';
import { contactsRoutes } from './handlers';
import { contacts } from './schema';

const BASE = 'http://localhost/api/contacts';

function createApp(
  db: VobaseDb,
  user = { id: 'user-1', email: 'test@test.com', name: 'Test', role: 'user' },
) {
  const app = new Hono();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('user', user);
    c.set('scheduler', {} as never);
    c.set('storage', {} as never);
    c.set('channels', {} as never);
    c.set('http', {} as never);
    c.set('realtime', {
      subscribe: () => () => {},
      notify: async () => {},
      shutdown: async () => {},
    } as never);
    await next();
  });
  app.route('/api/contacts', contactsRoutes);
  return app;
}

describe('Contacts Routes', () => {
  let pglite: PGlite;
  let db: VobaseDb;
  let app: Hono;

  beforeEach(async () => {
    const testDb = await createTestDb();
    pglite = testDb.pglite;
    db = testDb.db;
    app = createApp(db);
  });

  afterEach(async () => {
    await pglite.close();
  });

  describe('POST / — create contact', () => {
    it('creates a contact with phone', async () => {
      const res = await app.request(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '+6591234567', name: 'Alice' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.phone).toBe('+6591234567');
      expect(body.name).toBe('Alice');
      expect(body.role).toBe('customer');
      expect(body.id).toBeDefined();
    });

    it('creates a contact with email', async () => {
      const res = await app.request(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alice@example.com', role: 'staff' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.email).toBe('alice@example.com');
      expect(body.role).toBe('staff');
    });

    it('returns 400 when both phone and email are missing', async () => {
      const res = await app.request(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No contact' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid role', async () => {
      const res = await app.request(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '+1234', role: 'admin' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET / — list contacts', () => {
    it('lists all contacts', async () => {
      await db
        .insert(contacts)
        .values({ phone: '+111', name: 'Alice', role: 'customer' });
      await db
        .insert(contacts)
        .values({ email: 'bob@example.com', name: 'Bob', role: 'staff' });

      const res = await app.request(BASE);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
    });

    it('filters by search query', async () => {
      await db
        .insert(contacts)
        .values({ phone: '+111', name: 'Alice', role: 'customer' });
      await db
        .insert(contacts)
        .values({ email: 'bob@example.com', name: 'Bob', role: 'staff' });

      const res = await app.request(`${BASE}?search=alice`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Alice');
    });

    it('respects limit and offset', async () => {
      await db.insert(contacts).values({ phone: '+111', role: 'customer' });
      await db.insert(contacts).values({ phone: '+222', role: 'customer' });
      await db.insert(contacts).values({ phone: '+333', role: 'customer' });

      const res = await app.request(`${BASE}?limit=2&offset=1`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
    });
  });

  describe('GET /search — exact match', () => {
    it('finds contact by phone', async () => {
      await db.insert(contacts).values({
        phone: '+6591234567',
        email: 'alice@example.com',
        role: 'customer',
      });

      const res = await app.request(`${BASE}/search?phone=%2B6591234567`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].phone).toBe('+6591234567');
    });

    it('finds contact by email', async () => {
      await db
        .insert(contacts)
        .values({ email: 'bob@example.com', role: 'customer' });

      const res = await app.request(`${BASE}/search?email=bob%40example.com`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].email).toBe('bob@example.com');
    });

    it('returns 400 when neither phone nor email provided', async () => {
      const res = await app.request(`${BASE}/search`);
      expect(res.status).toBe(400);
    });

    it('returns empty array when no match', async () => {
      const res = await app.request(`${BASE}/search?phone=%2B9999`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(0);
    });
  });

  describe('GET /:id — get single contact', () => {
    it('returns contact by id', async () => {
      const [created] = await db
        .insert(contacts)
        .values({ phone: '+111', name: 'Alice', role: 'customer' })
        .returning();

      const res = await app.request(`${BASE}/${created.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(created.id);
      expect(body.name).toBe('Alice');
    });

    it('returns 404 for non-existent id', async () => {
      const res = await app.request(`${BASE}/nonexistent-id`);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /:id — update contact', () => {
    it('updates contact fields', async () => {
      const [created] = await db
        .insert(contacts)
        .values({ phone: '+111', name: 'Alice', role: 'customer' })
        .returning();

      const res = await app.request(`${BASE}/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice Updated', role: 'lead' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Alice Updated');
      expect(body.role).toBe('lead');
      expect(body.phone).toBe('+111');
    });

    it('returns 404 for non-existent id', async () => {
      const res = await app.request(`${BASE}/nonexistent-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ghost' }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid role', async () => {
      const [created] = await db
        .insert(contacts)
        .values({ phone: '+111', role: 'customer' })
        .returning();

      const res = await app.request(`${BASE}/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'superadmin' }),
      });

      expect(res.status).toBe(400);
    });
  });
});
