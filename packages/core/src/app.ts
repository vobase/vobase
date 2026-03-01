import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';

import { createAuth } from './auth';
import { contextMiddleware } from './ctx';
import { createDatabase } from './db/client';
import { runMigrations } from './db/migrator';
import { errorHandler } from './errors';
import { createWorker } from './job';
import { logger } from './logger';
import { optionalSessionMiddleware } from './middleware/session';
import type { VobaseModule } from './module';
import { createScheduler } from './queue';
import { createStorage } from './storage';

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
  mcp?: { enabled?: boolean };
}

export function createApp(config: CreateAppConfig): Hono {
  const db = createDatabase(config.database);

  const migrationsFolder = resolveMigrationsFolder();
  if (existsSync(migrationsFolder)) {
    runMigrations(db, migrationsFolder);
  } else {
    logger.warn('Skipping migrations because folder is missing', { migrationsFolder });
  }

  const auth = createAuth(db);

  const queueDbPath = deriveQueueDbPath(config.database);
  const { scheduler, effectiveQueueDbPath } = createSchedulerWithFallback(queueDbPath);

  const storage = createStorage(config.storage?.basePath ?? './data/files');

  const app = new Hono();

  app.onError(errorHandler);
  app.use('*', contextMiddleware({ db, scheduler, storage }));
  app.use('/api/*', optionalSessionMiddleware(auth));

  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
  app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

  const routedApp = config.modules.reduce(
    (acc, mod) => acc.route(`/api/${mod.name}`, mod.routes),
    app as Hono
  );

  if (config.mcp?.enabled) {
    routedApp.all('/mcp', (c) => c.json({ error: { code: 'NOT_IMPLEMENTED' } }, 501));
  }

  const allJobs = config.modules.flatMap((module) => module.jobs ?? []);
  if (allJobs.length > 0) {
    createWorker(allJobs, { dbPath: effectiveQueueDbPath });
  }

  return routedApp;
}
