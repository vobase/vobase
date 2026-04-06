import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';

import {
  contextMiddleware,
  getCtx,
  type VobaseCtx,
  type VobaseUser,
} from './ctx';
import type { VobaseDb } from './db';
import type { HttpClient } from './infra/http-client';
import type { Scheduler } from './infra/queue';
import type { RealtimeService } from './infra/realtime';
import type { ChannelsService } from './modules/channels/service';
import type { IntegrationsService } from './modules/integrations/service';
import type { StorageService } from './modules/storage/service';

const db = {} as VobaseDb;
const scheduler: Scheduler = {
  async add() {},
  async send() {
    return null;
  },
  async schedule() {},
  async unschedule() {},
  async stop() {},
};
const storage: StorageService = {
  bucket() {
    throw new Error('not implemented');
  },
};
const channels: ChannelsService = {
  email: { send: async () => ({ success: true }) },
  whatsapp: { send: async () => ({ success: true }) },
  on() {},
  registerAdapter() {},
  onProvision() {},
  async provision() {
    throw new Error('not implemented');
  },
};
const integrations = {} as IntegrationsService;
const mockResponse = {
  ok: true,
  status: 200,
  headers: new Headers(),
  data: null,
  raw: new Response(),
};
const http: HttpClient = {
  fetch: async () => mockResponse,
  get: async () => mockResponse,
  post: async () => mockResponse,
  put: async () => mockResponse,
  delete: async () => mockResponse,
} as HttpClient;
const realtime: RealtimeService = {
  subscribe: () => () => {},
  notify: async () => {},
  shutdown: async () => {},
};

function expectType<T>(_value: T): void {}

describe('ctx helpers', () => {
  it('getCtx(c) returns all properties when set', async () => {
    const user: VobaseUser = {
      id: 'user_123',
      email: 'user@example.com',
      name: 'Test User',
      role: 'admin',
    };

    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', db);
      c.set('scheduler', scheduler);
      c.set('storage', storage);
      c.set('channels', channels);
      c.set('integrations', integrations);
      c.set('http', http);
      c.set('user', user);
      await next();
    });
    app.get('/', (c) => {
      const ctx = getCtx(c);
      return c.json({
        hasDb: ctx.db === db,
        hasScheduler: ctx.scheduler === scheduler,
        hasStorage: ctx.storage === storage,
        hasChannels: ctx.channels === channels,
        hasIntegrations: ctx.integrations === integrations,
        hasHttp: ctx.http === http,
        user: ctx.user,
      });
    });

    const response = await app.request('http://localhost/');
    const body = (await response.json()) as {
      hasDb: boolean;
      hasScheduler: boolean;
      hasStorage: boolean;
      hasChannels: boolean;
      hasIntegrations: boolean;
      hasHttp: boolean;
      user: VobaseUser | null;
    };

    expect(response.status).toBe(200);
    expect(body.hasDb).toBe(true);
    expect(body.hasScheduler).toBe(true);
    expect(body.hasStorage).toBe(true);
    expect(body.hasChannels).toBe(true);
    expect(body.hasIntegrations).toBe(true);
    expect(body.hasHttp).toBe(true);
    expect(body.user).toEqual(user);
  });

  it('returns null user when session middleware did not set user', async () => {
    const app = new Hono();
    app.use(
      '*',
      contextMiddleware({
        db,
        scheduler,
        storage,
        channels,
        integrations,
        http,
        realtime,
      }),
    );
    app.get('/', (c) => c.json({ user: getCtx(c).user }));

    const response = await app.request('http://localhost/');
    const body = (await response.json()) as { user: VobaseUser | null };

    expect(response.status).toBe(200);
    expect(body.user).toBeNull();
  });

  it('contextMiddleware sets db, scheduler, storage, and http', async () => {
    const app = new Hono();
    app.use(
      '*',
      contextMiddleware({
        db,
        scheduler,
        storage,
        channels,
        integrations,
        http,
        realtime,
      }),
    );
    app.get('/', (c) => {
      return c.json({
        hasDb: c.get('db') === db,
        hasScheduler: c.get('scheduler') === scheduler,
        hasStorage: c.get('storage') === storage,
        hasHttp: c.get('http') === http,
      });
    });

    const response = await app.request('http://localhost/');
    const body = (await response.json()) as {
      hasDb: boolean;
      hasScheduler: boolean;
      hasStorage: boolean;
      hasHttp: boolean;
    };

    expect(response.status).toBe(200);
    expect(body.hasDb).toBe(true);
    expect(body.hasScheduler).toBe(true);
    expect(body.hasStorage).toBe(true);
    expect(body.hasHttp).toBe(true);
  });

  it('getCtx(c) includes http client', async () => {
    const app = new Hono();
    app.use(
      '*',
      contextMiddleware({
        db,
        scheduler,
        storage,
        channels,
        integrations,
        http,
        realtime,
      }),
    );
    app.get('/', (c) => {
      const ctx = getCtx(c);
      return c.json({ hasHttp: ctx.http === http });
    });

    const response = await app.request('http://localhost/');
    const body = (await response.json()) as { hasHttp: boolean };

    expect(response.status).toBe(200);
    expect(body.hasHttp).toBe(true);
  });

  it('exposes correctly typed properties on VobaseCtx', async () => {
    const app = new Hono();
    app.use(
      '*',
      contextMiddleware({
        db,
        scheduler,
        storage,
        channels,
        integrations,
        http,
        realtime,
      }),
    );
    app.get('/', (c) => {
      const ctx = getCtx(c);
      expectType<VobaseCtx>(ctx);
      expectType<VobaseDb>(ctx.db);
      expectType<VobaseUser | null>(ctx.user);
      expectType<Scheduler>(ctx.scheduler);
      expectType<StorageService>(ctx.storage);
      expectType<ChannelsService>(ctx.channels);
      expectType<IntegrationsService>(ctx.integrations);
      expectType<HttpClient>(ctx.http);
      expectType<RealtimeService>(ctx.realtime);
      return c.text('ok');
    });

    const response = await app.request('http://localhost/');
    expect(response.status).toBe(200);
  });
});
