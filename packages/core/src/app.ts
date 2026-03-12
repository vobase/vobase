import { Hono } from 'hono';

import { contextMiddleware } from './ctx';
import { createDatabase } from './db/client';
import { createHttpClient, type HttpClientOptions } from './http-client';
import { errorHandler } from './errors';
import { createWorker } from './job';
import { logger } from './logger';
import { createMcpHandler } from './mcp';
import { createAuditModule } from './modules/audit';
import { createAuthModule, optionalSessionMiddleware, type AuthModuleConfig } from './modules/auth';
import { createCredentialsModule } from './modules/credentials';
import { createNotifyModule, type NotifyModuleConfig } from './modules/notify';
import type { NotifyService } from './modules/notify/service';
import { createSequencesModule } from './modules/sequences';
import { createStorageModule, type StorageModuleConfig } from './modules/storage';
import type { StorageService } from './modules/storage/service';
import type { VobaseModule } from './module';
import { createScheduler } from './queue';
import { createThrowProxy } from './throw-proxy';
import { createWebhookRoutes, type WebhookConfig } from './webhooks';

const DEFAULT_QUEUE_DB_PATH = '/data/bunqueue.db';
const LOCAL_QUEUE_DB_PATH = './data/bunqueue.db';

function deriveQueueDbPath(databasePath: string): string {
  if (databasePath !== ':memory:' && databasePath.endsWith('.db')) {
    return databasePath.replace(/\.db$/, '-queue.db');
  }

  return DEFAULT_QUEUE_DB_PATH;
}

function createSchedulerWithFallback(queueDbPath: string) {
  try {
    return {
      scheduler: createScheduler({ dbPath: queueDbPath }),
      effectiveQueueDbPath: queueDbPath,
    };
  } catch (error) {
    if (queueDbPath !== DEFAULT_QUEUE_DB_PATH) {
      throw error;
    }

    logger.warn('Falling back to local queue database path', {
      queueDbPath,
      fallbackQueueDbPath: LOCAL_QUEUE_DB_PATH,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      scheduler: createScheduler({ dbPath: LOCAL_QUEUE_DB_PATH }),
      effectiveQueueDbPath: LOCAL_QUEUE_DB_PATH,
    };
  }
}

export interface CreateAppConfig {
  modules: VobaseModule[];
  database: string;
  storage?: StorageModuleConfig;
  notify?: NotifyModuleConfig;
  http?: HttpClientOptions;
  webhooks?: Record<string, WebhookConfig>;
  mcp?: { enabled?: boolean };
  trustedOrigins?: string[];
  auth?: Omit<AuthModuleConfig, 'trustedOrigins'>;
  /** Enable the credentials module (encrypted credential store). Default: false */
  credentials?: { enabled: boolean };
}

export function createApp(config: CreateAppConfig) {
  const db = createDatabase(config.database);

  const queueDbPath = deriveQueueDbPath(config.database);
  const { scheduler, effectiveQueueDbPath } =
    createSchedulerWithFallback(queueDbPath);

  const http = createHttpClient(config.http);

  // === Auth Module (always active) ===
  const authMod = createAuthModule(db, {
    ...config.auth,
    trustedOrigins: config.trustedOrigins,
  });
  const authAdapter = authMod.adapter;

  // === Storage Module (config-driven) ===
  let storageMod: ReturnType<typeof createStorageModule> | undefined;
  let storageService: StorageService;
  if (config.storage) {
    storageMod = createStorageModule(db, config.storage);
    storageService = storageMod.service;
  } else {
    storageService = createThrowProxy<StorageService>('storage');
  }

  // === Notify Module (config-driven) ===
  let notifyMod: ReturnType<typeof createNotifyModule> | undefined;
  let notifyService: NotifyService;
  if (config.notify) {
    notifyMod = createNotifyModule(db, config.notify);
    notifyService = notifyMod.service;
  } else {
    notifyService = createThrowProxy<NotifyService>('notify');
  }

  // === Built-in Module Init ===
  const initCtx = { db, scheduler, http, storage: storageService, notify: notifyService };

  const auditMod = createAuditModule();
  auditMod.init?.(initCtx);

  const seqMod = createSequencesModule();
  seqMod.init?.(initCtx);

  let credMod: VobaseModule | undefined;
  if (config.credentials?.enabled) {
    credMod = createCredentialsModule();
    credMod.init?.(initCtx);
  }

  // === Base app with middleware ===
  const base = new Hono();
  base.onError(errorHandler);
  base.use('*', contextMiddleware({ db, scheduler, storage: storageService, notify: notifyService, http }));
  base.use('/api/*', optionalSessionMiddleware(authAdapter));
  base.on(['POST', 'GET'], '/api/auth/*', (c) => authAdapter.handler(c.req.raw));

  // Mount via chaining to preserve route types for hc<AppType>
  const app = base
    .get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

  // === Storage routes ===
  if (storageMod) {
    (app as Hono).route('/api/storage', storageMod.routes);
  }

  // === User Modules ===
  const userModules = config.modules;
  for (const mod of userModules) {
    mod.init?.(initCtx);
    (app as Hono).route(`/api/${mod.name}`, mod.routes);
  }

  // === Webhooks ===
  if (config.webhooks && Object.keys(config.webhooks).length > 0) {
    const webhookRouter = createWebhookRoutes(config.webhooks, { db, scheduler });
    (app as Hono).route('', webhookRouter);
  }

  // === MCP + Jobs ===
  const builtInModules: VobaseModule[] = [authMod, auditMod, seqMod];
  if (storageMod) builtInModules.push(storageMod);
  if (notifyMod) builtInModules.push(notifyMod);
  if (credMod) builtInModules.push(credMod);
  const allModules = [...builtInModules, ...userModules];

  if (config.mcp?.enabled) {
    const mcpHandler = createMcpHandler({ db, modules: allModules });
    (app as Hono).all('/mcp', async (c) => {
      const response = await mcpHandler(c.req.raw);
      return response;
    });
  }

  const allJobs = allModules.flatMap((module) => module.jobs ?? []);
  if (allJobs.length > 0) {
    createWorker(allJobs, { dbPath: effectiveQueueDbPath });
  }

  return app;
}
