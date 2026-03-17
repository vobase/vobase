import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Hono } from 'hono';

import type { VobaseDb } from '../../db';
import { createAuthAuditHooks } from '../auth/audit-hooks';
import { requestAuditMiddleware } from './middleware';
import * as schema from './schema';

interface AuditRow {
  event: string;
  actorId: string | null;
  actorEmail: string | null;
  ip: string | null;
  details: string | null;
}

describe('audit middleware and hooks', () => {
  let pglite: PGlite;
  let db: VobaseDb;

  beforeEach(async () => {
    pglite = new PGlite();
    await pglite.query(`
      CREATE TABLE _audit_log (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        event TEXT NOT NULL,
        actor_id TEXT,
        actor_email TEXT,
        ip TEXT,
        details TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    db = drizzle({ client: pglite, schema }) as unknown as VobaseDb;
  });

  afterEach(async () => {
    await pglite.close();
  });

  async function getRows(): Promise<AuditRow[]> {
    const result = await pglite.query<AuditRow>(`
      SELECT
        event,
        actor_id AS "actorId",
        actor_email AS "actorEmail",
        ip,
        details
      FROM _audit_log
      ORDER BY created_at ASC
    `);
    return result.rows;
  }

  it('logs api_mutation for POST requests', async () => {
    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      c.set('user', {
        id: 'user_post',
        email: 'post@example.com',
        name: 'Post User',
        role: 'user',
      });
      await next();
    });
    app.use('/api/*', requestAuditMiddleware(db));
    app.post('/api/test', (c) => c.json({ ok: true }));

    const response = await app.request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });

    expect(response.status).toBe(200);

    const rows = await getRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      event: 'api_mutation',
      actorId: 'user_post',
      actorEmail: 'post@example.com',
      ip: '203.0.113.10',
      details: JSON.stringify({ method: 'POST', path: '/api/test' }),
    });
  });

  it('does not log GET requests', async () => {
    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      c.set('user', {
        id: 'user_get',
        email: 'get@example.com',
        name: 'Get User',
        role: 'user',
      });
      await next();
    });
    app.use('/api/*', requestAuditMiddleware(db));
    app.get('/api/test', (c) => c.json({ ok: true }));

    const response = await app.request('http://localhost/api/test', {
      method: 'GET',
      headers: { 'x-forwarded-for': '203.0.113.11' },
    });

    expect(response.status).toBe(200);
    expect(await getRows()).toHaveLength(0);
  });

  it('logs signin events from auth hooks', async () => {
    const hooks = createAuthAuditHooks(db);

    await hooks.after({
      path: '/sign-in/email',
      method: 'POST',
      headers: new Headers({ 'x-real-ip': '198.51.100.8' }),
      context: {
        newSession: {
          user: { id: 'user_signin', email: 'signin@example.com' },
        },
        session: null,
      },
      returnHeaders: true,
    } as unknown as Parameters<typeof hooks.after>[0]);

    const rows = await getRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      event: 'signin',
      actorId: 'user_signin',
      actorEmail: 'signin@example.com',
      ip: '198.51.100.8',
      details: JSON.stringify({ path: '/sign-in/email' }),
    });
  });

  it('logs signup events from auth hooks', async () => {
    const hooks = createAuthAuditHooks(db);

    await hooks.after({
      path: '/sign-up/email',
      method: 'POST',
      headers: new Headers({ 'x-forwarded-for': '192.0.2.25, 10.0.0.1' }),
      context: {
        newSession: {
          user: { id: 'user_signup', email: 'signup@example.com' },
        },
        session: null,
      },
      returnHeaders: true,
    } as unknown as Parameters<typeof hooks.after>[0]);

    const rows = await getRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      event: 'signup',
      actorId: 'user_signup',
      actorEmail: 'signup@example.com',
      ip: '192.0.2.25',
      details: JSON.stringify({ path: '/sign-up/email' }),
    });
  });
});
