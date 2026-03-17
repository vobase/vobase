import { afterAll, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';

import { createApp } from './app';
import { notFound } from './infra/errors';
import type { VobaseModule } from './module';

afterAll(async () => {
  // pg-boss shuts down gracefully with the app; no manual cleanup needed
});

function makeModule(
  name: string,
  routeFactory: (routes: Hono) => void,
): VobaseModule {
  const routes = new Hono();
  routeFactory(routes);

  return {
    name,
    schema: { test: {} },
    routes,
  };
}

describe('createApp()', () => {
  it('creates a Hono app for in-memory database', async () => {
    const app = await createApp({ modules: [], database: 'memory://' });
    expect(app).toBeInstanceOf(Hono);
  });

  it('serves GET /health with status and uptime', async () => {
    const app = await createApp({ modules: [], database: 'memory://' });

    const response = await app.request('http://localhost/health');
    const body = (await response.json()) as { status: string; uptime: number };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });

  it('mounts /api/auth/* routes (not 404)', async () => {
    const app = await createApp({ modules: [], database: 'memory://' });

    const response = await app.request('http://localhost/api/auth/get-session');

    expect(response.status).not.toBe(404);
  });

  it('mounts module routes under /api/{module}', async () => {
    const testModule = makeModule('testmod', (routes) => {
      routes.get('/ping', (c) => c.json({ pong: true }));
    });
    const app = await createApp({
      modules: [testModule],
      database: 'memory://',
    });

    const response = await app.request('http://localhost/api/testmod/ping');
    const body = (await response.json()) as { pong: boolean };

    expect(response.status).toBe(200);
    expect(body.pong).toBe(true);
  });

  it('uses global error handler for thrown VobaseError', async () => {
    const throwingModule = makeModule('errors', (routes) => {
      routes.get('/boom', () => {
        throw notFound('Record');
      });
    });
    const app = await createApp({
      modules: [throwingModule],
      database: 'memory://',
    });

    const response = await app.request('http://localhost/api/errors/boom');
    const body = (await response.json()) as {
      error: { code: string; message: string; details?: unknown };
    };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Record not found');
  });

  it('allows unauthenticated access on /api/* with optional session middleware', async () => {
    const openModule = makeModule('open', (routes) => {
      routes.get('/status', (c) => c.json({ user: c.get('user') }));
    });
    const app = await createApp({
      modules: [openModule],
      database: 'memory://',
    });

    const response = await app.request('http://localhost/api/open/status');
    const body = (await response.json()) as { user: unknown };

    expect(response.status).toBe(200);
    expect(body.user).toBeNull();
  });
});
