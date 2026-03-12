import { describe, expect, it, beforeEach } from 'bun:test';
import { Hono } from 'hono';

import { requireRole, requirePermission, requireOrg } from '../modules/auth/permissions';
import { setOrganizationEnabled } from '../modules/auth/permissions';

function createTestApp() {
  const app = new Hono();
  // Simulate the context variable map user field
  return app;
}

function withUser(app: Hono, user: { id: string; email: string; name: string; role: string; activeOrganizationId?: string; orgRole?: string } | null) {
  app.use('*', async (c, next) => {
    c.set('user', user as any);
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
    app.get('/test', requireRole('admin', 'editor'), (c) => c.json({ ok: true }));

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
  beforeEach(() => {
    setOrganizationEnabled(false);
  });

  it('throws descriptive error at call time when org is NOT enabled', () => {
    setOrganizationEnabled(false);
    expect(() => requirePermission('invoices:write')).toThrow(
      'Organization plugin required for permission-based auth. Use requireRole() instead or enable organization in config.',
    );
  });

  it('returns middleware when org IS enabled', () => {
    setOrganizationEnabled(true);
    const middleware = requirePermission('invoices:write');
    expect(typeof middleware).toBe('function');
  });

  it('middleware rejects unauthenticated request when org is enabled', async () => {
    setOrganizationEnabled(true);
    const app = createTestApp();
    withUser(app, null);
    app.get('/test', requirePermission('invoices:write'), (c) => c.json({ ok: true }));
    app.onError((err, c) => c.json({ error: err.message }, 403));

    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });

  it('middleware allows authenticated user when org is enabled', async () => {
    setOrganizationEnabled(true);
    const app = createTestApp();
    withUser(app, { id: '1', email: 'a@b.com', name: 'Test', role: 'admin' });
    app.get('/test', requirePermission('invoices:write'), (c) => c.json({ ok: true }));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });
});

describe('requireOrg', () => {
  beforeEach(() => {
    setOrganizationEnabled(false);
  });

  it('throws descriptive error at call time when org is NOT enabled', () => {
    setOrganizationEnabled(false);
    expect(() => requireOrg()).toThrow(
      'Organization plugin required. Enable organization in config.',
    );
  });

  it('rejects user without active organization with 403 when org is enabled', async () => {
    setOrganizationEnabled(true);
    const app = createTestApp();
    withUser(app, { id: '1', email: 'a@b.com', name: 'Test', role: 'user' });
    app.get('/test', requireOrg(), (c) => c.json({ ok: true }));
    app.onError((err, c) => c.json({ error: err.message }, 403));

    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });

  it('allows user with active organization when org is enabled', async () => {
    setOrganizationEnabled(true);
    const app = createTestApp();
    withUser(app, { id: '1', email: 'a@b.com', name: 'Test', role: 'user', activeOrganizationId: 'org-1' });
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

  it('excludes org schema by default', async () => {
    const { getActiveSchemas } = await import('../schemas');
    const schemas = getActiveSchemas();
    expect(schemas.organization).toBeUndefined();
    expect(schemas.member).toBeUndefined();
    expect(schemas.invitation).toBeUndefined();
  });

  it('includes org schema when organization is true', async () => {
    const { getActiveSchemas } = await import('../schemas');
    const schemas = getActiveSchemas({ organization: true });
    expect(schemas.organization).toBeDefined();
    expect(schemas.member).toBeDefined();
    expect(schemas.invitation).toBeDefined();
  });
});
