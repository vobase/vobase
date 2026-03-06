import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';

import {
  contextMiddleware,
  getCtx,
  type VobaseCtx,
  type VobaseUser,
} from './ctx';
import type { VobaseDb } from './db';
import type { HttpClient } from './http-client';
import type { Scheduler } from './queue';
import type { Storage } from './storage';

const db = {} as VobaseDb;
const scheduler: Scheduler = {
  async add() {},
};
const storage: Storage = {
  async upload() {},
  async download() {
    return new Uint8Array();
  },
  getUrl(path) {
    return path;
  },
  async delete() {},
};
const http: HttpClient = {
  async fetch() {
    return { ok: true, status: 200, headers: new Headers(), data: null, raw: new Response() };
  },
  async get() {
    return { ok: true, status: 200, headers: new Headers(), data: null, raw: new Response() };
  },
  async post() {
    return { ok: true, status: 200, headers: new Headers(), data: null, raw: new Response() };
  },
  async put() {
    return { ok: true, status: 200, headers: new Headers(), data: null, raw: new Response() };
  },
  async delete() {
    return { ok: true, status: 200, headers: new Headers(), data: null, raw: new Response() };
  },
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
        hasHttp: ctx.http === http,
        user: ctx.user,
      });
    });

    const response = await app.request('http://localhost/');
    const body = (await response.json()) as {
      hasDb: boolean;
      hasScheduler: boolean;
      hasStorage: boolean;
      hasHttp: boolean;
      user: VobaseUser | null;
    };

    expect(response.status).toBe(200);
    expect(body.hasDb).toBe(true);
    expect(body.hasScheduler).toBe(true);
    expect(body.hasStorage).toBe(true);
    expect(body.hasHttp).toBe(true);
    expect(body.user).toEqual(user);
  });

  it('returns null user when session middleware did not set user', async () => {
    const app = new Hono();
    app.use('*', contextMiddleware({ db, scheduler, storage, http }));
    app.get('/', (c) => c.json({ user: getCtx(c).user }));

    const response = await app.request('http://localhost/');
    const body = (await response.json()) as { user: VobaseUser | null };

    expect(response.status).toBe(200);
    expect(body.user).toBeNull();
  });

  it('contextMiddleware sets db, scheduler, storage, and http', async () => {
    const app = new Hono();
    app.use('*', contextMiddleware({ db, scheduler, storage, http }));
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
    app.use('*', contextMiddleware({ db, scheduler, storage, http }));
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
    app.use('*', contextMiddleware({ db, scheduler, storage, http }));
    app.get('/', (c) => {
      const ctx = getCtx(c);
      expectType<VobaseCtx>(ctx);
      expectType<VobaseDb>(ctx.db);
      expectType<VobaseUser | null>(ctx.user);
      expectType<Scheduler>(ctx.scheduler);
      expectType<Storage>(ctx.storage);
      expectType<HttpClient>(ctx.http);
      return c.text('ok');
    });

    const response = await app.request('http://localhost/');
    expect(response.status).toBe(200);
  });
});
