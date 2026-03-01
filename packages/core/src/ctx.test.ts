import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';

import type { VobaseDb } from './db';
import type { Scheduler } from './queue';
import type { Storage } from './storage';
import { contextMiddleware, getCtx, type VobaseCtx, type VobaseUser } from './ctx';

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
      c.set('user', user);
      await next();
    });
    app.get('/', (c) => {
      const ctx = getCtx(c);
      return c.json({
        hasDb: ctx.db === db,
        hasScheduler: ctx.scheduler === scheduler,
        hasStorage: ctx.storage === storage,
        user: ctx.user,
      });
    });

    const response = await app.request('http://localhost/');
    const body = (await response.json()) as {
      hasDb: boolean;
      hasScheduler: boolean;
      hasStorage: boolean;
      user: VobaseUser | null;
    };

    expect(response.status).toBe(200);
    expect(body.hasDb).toBe(true);
    expect(body.hasScheduler).toBe(true);
    expect(body.hasStorage).toBe(true);
    expect(body.user).toEqual(user);
  });

  it('returns null user when session middleware did not set user', async () => {
    const app = new Hono();
    app.use('*', contextMiddleware({ db, scheduler, storage }));
    app.get('/', (c) => c.json({ user: getCtx(c).user }));

    const response = await app.request('http://localhost/');
    const body = (await response.json()) as { user: VobaseUser | null };

    expect(response.status).toBe(200);
    expect(body.user).toBeNull();
  });

  it('contextMiddleware sets db, scheduler, and storage', async () => {
    const app = new Hono();
    app.use('*', contextMiddleware({ db, scheduler, storage }));
    app.get('/', (c) => {
      return c.json({
        hasDb: c.get('db') === db,
        hasScheduler: c.get('scheduler') === scheduler,
        hasStorage: c.get('storage') === storage,
      });
    });

    const response = await app.request('http://localhost/');
    const body = (await response.json()) as {
      hasDb: boolean;
      hasScheduler: boolean;
      hasStorage: boolean;
    };

    expect(response.status).toBe(200);
    expect(body.hasDb).toBe(true);
    expect(body.hasScheduler).toBe(true);
    expect(body.hasStorage).toBe(true);
  });

  it('exposes correctly typed properties on VobaseCtx', async () => {
    const app = new Hono();
    app.use('*', contextMiddleware({ db, scheduler, storage }));
    app.get('/', (c) => {
      const ctx = getCtx(c);
      expectType<VobaseCtx>(ctx);
      expectType<VobaseDb>(ctx.db);
      expectType<VobaseUser | null>(ctx.user);
      expectType<Scheduler>(ctx.scheduler);
      expectType<Storage>(ctx.storage);
      return c.text('ok');
    });

    const response = await app.request('http://localhost/');
    expect(response.status).toBe(200);
  });
});
