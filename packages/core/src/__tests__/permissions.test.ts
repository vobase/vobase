import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';

import type { AuthUser } from '../contracts/auth';
import {
  requireOrg,
  requirePermission,
  requireRole,
} from '../modules/auth/permissions';

function createTestApp() {
  const app = new Hono();
  return app;
}

function withUser(app: Hono, user: AuthUser | null) {
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  return app;
}

describe('requireRole', () => {
  it('allows user with matching role', async () => {
    const app = createTestApp();
    withUser(app, { id: '1', email: 'a@b.com', name: 'Test', role: 'admin' });
    app.get('/test', requireRole('admin'), (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('allows user with any of multiple roles', async () => {
    const app = createTestApp();
    withUser(app, { id: '1', email: 'a@b.com', name: 'Test', role: 'editor' });
    app.get('/test', requireRole('admin', 'editor'), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('rejects user with non-matching role with 403', async () => {
    const app = createTestApp();
    withUser(app, { id: '1', email: 'a@b.com', name: 'Test', role: 'user' });
    app.get('/test', requireRole('admin'), (c) => c.json({ ok: true }));
    app.onError((err, c) => c.json({ error: err.message }, 403));

    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated request (no user) with 403', async () => {
    const app = createTestApp();
    withUser(app, null);
    app.get('/test', requireRole('admin'), (c) => c.json({ ok: true }));
    app.onError((err, c) => c.json({ error: err.message }, 403));

    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });
});

describe('requirePermission', () => {
  it('returns middleware', () => {
    const middleware = requirePermission('invoices:write');
    expect(typeof middleware).toBe('function');
  });

  it('rejects unauthenticated request', async () => {
    const app = createTestApp();
    withUser(app, null);
    app.get('/test', requirePermission('invoices:write'), (c) =>
      c.json({ ok: true }),
    );
    app.onError((err, c) => c.json({ error: err.message }, 403));

    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });

  it('allows authenticated user', async () => {
    const app = createTestApp();
    withUser(app, { id: '1', email: 'a@b.com', name: 'Test', role: 'admin' });
    app.get('/test', requirePermission('invoices:write'), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });
});

describe('requireOrg', () => {
  it('rejects user without active organization with 403', async () => {
    const app = createTestApp();
    withUser(app, { id: '1', email: 'a@b.com', name: 'Test', role: 'user' });
    app.get('/test', requireOrg(), (c) => c.json({ ok: true }));
    app.onError((err, c) => c.json({ error: err.message }, 403));

    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });

  it('allows user with active organization', async () => {
    const app = createTestApp();
    withUser(app, {
      id: '1',
      email: 'a@b.com',
      name: 'Test',
      role: 'user',
      activeOrganizationId: 'org-1',
    });
    app.get('/test', requireOrg(), (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });
});

describe('getActiveSchemas', () => {
  it('always includes apikey schema', async () => {
    const { getActiveSchemas } = await import('../schemas');
    const schemas = getActiveSchemas();
    expect(schemas.apikey).toBeDefined();
  });

  it('always includes org schema', async () => {
    const { getActiveSchemas } = await import('../schemas');
    const schemas = getActiveSchemas();
    expect(schemas.organization).toBeDefined();
    expect(schemas.member).toBeDefined();
    expect(schemas.invitation).toBeDefined();
  });
});
