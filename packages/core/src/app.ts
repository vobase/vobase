import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'bun:sqlite';
import { Hono } from 'hono';

import { createAuth } from './auth';
import { contextMiddleware } from './ctx';
import { createDatabase, type VobaseDb } from './db/client';
import { createHttpClient, type HttpClientOptions } from './http-client';
import { ensureCoreTables } from './db/ensure-core-tables';
import { runMigrations } from './db/migrator';
import { errorHandler } from './errors';
import { createWorker } from './job';
import { logger } from './logger';
import { createMcpHandler } from './mcp';
import { optionalSessionMiddleware } from './middleware/session';
import type { VobaseModule } from './module';
import { createScheduler } from './queue';
import { createStorage } from './storage';
import { createSystemModule } from './system';
import { createSystemRoutes } from './system/handlers';
import { createWebhookRoutes, type WebhookConfig } from './webhooks';

const DEFAULT_QUEUE_DB_PATH = '/data/bunqueue.db';
const LOCAL_QUEUE_DB_PATH = './data/bunqueue.db';

function deriveQueueDbPath(databasePath: string): string {
  if (databasePath !== ':memory:' && databasePath.endsWith('.db')) {
    return databasePath.replace(/\.db$/, '-queue.db');
  }

  return DEFAULT_QUEUE_DB_PATH;
}

function resolveMigrationsFolder(): string {
  const srcDir = dirname(fileURLToPath(import.meta.url));
  return resolve(srcDir, '../migrations');
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
}

export function createApp(config: CreateAppConfig) {
  const db = createDatabase(config.database);
  ensureCoreTables((db as VobaseDb & { $client: Database }).$client);

  const migrationsFolder = resolveMigrationsFolder();
  if (existsSync(migrationsFolder)) {
    runMigrations(db, migrationsFolder);
  } else {
    logger.debug('Skipping migrations because folder is missing', {
      migrationsFolder,
    });
  }

  const auth = createAuth(db, { trustedOrigins: config.trustedOrigins });

  const queueDbPath = deriveQueueDbPath(config.database);
  const { scheduler, effectiveQueueDbPath } =
    createSchedulerWithFallback(queueDbPath);

  const storage = createStorage(config.storage?.basePath ?? './data/files');
  const http = createHttpClient(config.http);

  // Base app with middleware (imperative — these don't affect RPC schema types)
  const base = new Hono();
  base.onError(errorHandler);
  base.use('*', contextMiddleware({ db, scheduler, storage, http }));
  base.use('/api/*', optionalSessionMiddleware(auth));
  base.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  // Mount system module via chaining to preserve route types for hc<AppType>
  const app = base
    .get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }))
    .route('/api/system', createSystemRoutes(auth));

  // Mount user modules (types not preserved for RPC, but runtime works)
  // Filter out 'system' since it's auto-mounted above
  const userModules = config.modules.filter((mod) => mod.name !== 'system');
  for (const mod of userModules) {
    (app as Hono).route(`/api/${mod.name}`, mod.routes);
  }

  // Mount webhook routes if configured
  if (config.webhooks && Object.keys(config.webhooks).length > 0) {
    const rawDb = (db as VobaseDb & { $client: Database }).$client;
    const webhookRouter = createWebhookRoutes(config.webhooks, { db: rawDb, scheduler });
    (app as Hono).route('', webhookRouter);
  }

  // Include system module in the full modules list for MCP and jobs
  const systemModule = createSystemModule(auth);
  const allModules = [systemModule, ...userModules];

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
