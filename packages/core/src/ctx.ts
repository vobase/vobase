import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { VobaseDb } from './db';
import type { HttpClient } from './http-client';
import type { Scheduler } from './queue';
import type { NotifyService } from './modules/notify/service';
import type { StorageService } from './modules/storage/service';

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
  storage: StorageService;
  notify: NotifyService;
  http: HttpClient;
}

declare module 'hono' {
  interface ContextVariableMap {
    db: VobaseDb;
    scheduler: Scheduler;
    storage: StorageService;
    notify: NotifyService;
    http: HttpClient;
  }
}

export function contextMiddleware(deps: {
  db: VobaseDb;
  scheduler: Scheduler;
  storage: StorageService;
  notify: NotifyService;
  http: HttpClient;
}) {
  return createMiddleware(async (c, next) => {
    c.set('db', deps.db);
    c.set('scheduler', deps.scheduler);
    c.set('storage', deps.storage);
    c.set('notify', deps.notify);
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
    notify: c.get('notify'),
    http: c.get('http'),
  };
}
