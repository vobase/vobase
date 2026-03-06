import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { VobaseDb } from './db';
import type { HttpClient } from './http-client';
import type { Scheduler } from './queue';
import type { Storage } from './storage';

export interface VobaseUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface VobaseCtx {
  db: VobaseDb;
  user: VobaseUser | null;
  scheduler: Scheduler;
  storage: Storage;
  http: HttpClient;
}

declare module 'hono' {
  interface ContextVariableMap {
    db: VobaseDb;
    scheduler: Scheduler;
    storage: Storage;
    http: HttpClient;
  }
}

export function contextMiddleware(deps: {
  db: VobaseDb;
  scheduler: Scheduler;
  storage: Storage;
  http: HttpClient;
}) {
  return createMiddleware(async (c, next) => {
    c.set('db', deps.db);
    c.set('scheduler', deps.scheduler);
    c.set('storage', deps.storage);
    c.set('http', deps.http);
    await next();
  });
}

export function getCtx(c: Context): VobaseCtx {
  return {
    db: c.get('db'),
    user: c.get('user') ?? null,
    scheduler: c.get('scheduler'),
    storage: c.get('storage'),
    http: c.get('http'),
  };
}
