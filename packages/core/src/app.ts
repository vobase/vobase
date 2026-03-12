import { Hono } from 'hono';

import { createAuth, type CreateAuthOptions } from './auth';
import { contextMiddleware } from './ctx';
import { createDatabase, type VobaseDb } from './db/client';
import { createHttpClient, type HttpClientOptions } from './http-client';
import { errorHandler } from './errors';
import { createWorker } from './job';
import { logger } from './logger';
import { createMcpHandler } from './mcp';
import { optionalSessionMiddleware } from './middleware/session';
import { createAuditModule } from './modules/audit';
import { createCredentialsModule } from './modules/credentials';
import { createSequencesModule } from './modules/sequences';
import type { VobaseModule } from './module';
import { createScheduler } from './queue';
import { createStorage } from './storage';
import { createThrowProxy } from './throw-proxy';
import { createWebhookRoutes, type WebhookConfig } from './webhooks';
import type { EmailProvider } from './contracts/notify';
import type { StorageProvider } from './contracts/storage';

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
  storage?: { basePath: string };
  http?: HttpClientOptions;
  webhooks?: Record<string, WebhookConfig>;
  mcp?: { enabled?: boolean };
  trustedOrigins?: string[];
  auth?: Omit<CreateAuthOptions, 'baseURL' | 'trustedOrigins'>;
  /** Enable the credentials module (encrypted credential store). Default: false */
  credentials?: { enabled: boolean };
}

export function createApp(config: CreateAppConfig) {
  const db = createDatabase(config.database);

  const auth = createAuth(db, { trustedOrigins: config.trustedOrigins, ...config.auth });

  const queueDbPath = deriveQueueDbPath(config.database);
  const { scheduler, effectiveQueueDbPath } =
    createSchedulerWithFallback(queueDbPath);

  const storage = createStorage(config.storage?.basePath ?? './data/files');
  const http = createHttpClient(config.http);

  // === Built-in Module Init ===
  const storageProvider = createThrowProxy<StorageProvider>('storage');
  const notify = createThrowProxy<EmailProvider>('notify');
  const initCtx = { db, scheduler, http, storage: storageProvider, notify };

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
  base.use('*', contextMiddleware({ db, scheduler, storage, http }));
  base.use('/api/*', optionalSessionMiddleware(auth));
  base.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  // Mount via chaining to preserve route types for hc<AppType>
  const app = base
    .get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

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
  const builtInModules: VobaseModule[] = [auditMod, seqMod];
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
