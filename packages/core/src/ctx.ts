import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { VobaseDb } from './db';
import type { HttpClient } from './infra/http-client';
import type { Scheduler } from './infra/queue';
import type { RealtimeService } from './infra/realtime';
import type { ChannelsService } from './modules/channels/service';
import type { IntegrationsService } from './modules/integrations/service';
import type { StorageService } from './modules/storage/service';

export interface VobaseUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /** Set when the user has an active organization (better-auth organization plugin) */
  activeOrganizationId?: string;
}

export interface VobaseCtx {
  db: VobaseDb;
  user: VobaseUser | null;
  scheduler: Scheduler;
  storage: StorageService;
  channels: ChannelsService;
  integrations: IntegrationsService;
  http: HttpClient;
  realtime: RealtimeService;
}

declare module 'hono' {
  interface ContextVariableMap {
    db: VobaseDb;
    scheduler: Scheduler;
    storage: StorageService;
    channels: ChannelsService;
    integrations: IntegrationsService;
    http: HttpClient;
    realtime: RealtimeService;
  }
}

export function contextMiddleware(deps: {
  db: VobaseDb;
  scheduler: Scheduler;
  storage: StorageService;
  channels: ChannelsService;
  integrations: IntegrationsService;
  http: HttpClient;
  realtime: RealtimeService;
}) {
  return createMiddleware(async (c, next) => {
    c.set('db', deps.db);
    c.set('scheduler', deps.scheduler);
    c.set('storage', deps.storage);
    c.set('channels', deps.channels);
    c.set('integrations', deps.integrations);
    c.set('http', deps.http);
    c.set('realtime', deps.realtime);
    await next();
  });
}

export function getCtx(c: Context): VobaseCtx {
  return {
    db: c.get('db'),
    user: c.get('user') ?? null,
    scheduler: c.get('scheduler'),
    storage: c.get('storage'),
    channels: c.get('channels'),
    integrations: c.get('integrations'),
    http: c.get('http'),
    realtime: c.get('realtime'),
  };
}
