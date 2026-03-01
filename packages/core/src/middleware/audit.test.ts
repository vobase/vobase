import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';

import type { VobaseDb } from '../db';
import * as schema from '../db/system-schema';
import { createAuthAuditHooks, requestAuditMiddleware } from './audit';

interface AuditRow {
  event: string;
  actorId: string | null;
  actorEmail: string | null;
  ip: string | null;
  details: string | null;
}

describe('audit middleware and hooks', () => {
  let sqlite: Database;
  let db: VobaseDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.run('PRAGMA journal_mode=WAL');
    sqlite.exec(`
      CREATE TABLE _audit_log (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        actor_id TEXT,
        actor_email TEXT,
        ip TEXT,
        details TEXT,
        created_at INTEGER NOT NULL
      )
    `);
    db = drizzle(sqlite, { schema }) as unknown as VobaseDb;
  });

  afterEach(() => {
    sqlite.close();
  });

  function getRows(): AuditRow[] {
    return sqlite
      .prepare(
        `
          SELECT
            event,
            actor_id AS actorId,
            actor_email AS actorEmail,
            ip,
            details
          FROM _audit_log
          ORDER BY rowid ASC
        `
      )
      .all() as AuditRow[];
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

    const rows = getRows();
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
    expect(getRows()).toHaveLength(0);
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
    } as any);

    const rows = getRows();
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
    } as any);

    const rows = getRows();
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
