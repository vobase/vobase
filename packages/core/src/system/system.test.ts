import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';

import type { Auth } from '../auth';
import { contextMiddleware } from '../ctx';
import type { VobaseDb } from '../db';
import { errorHandler } from '../errors';
import type { Scheduler } from '../queue';
import type { Storage } from '../storage';
import { createSystemRoutes } from './handlers';
import * as schema from './schema';

const AUTHORIZATION_HEADER = 'Bearer test-session';

function createAuthStub(): Auth {
  return {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        if (headers.get('authorization') !== AUTHORIZATION_HEADER) {
          return null;
        }

        return {
          user: {
            id: 'user_1',
            email: 'user@example.com',
            name: 'Test User',
            role: 'admin',
          },
        };
      },
    },
  } as unknown as Auth;
}

function createSystemTestApp(db: VobaseDb, auth: Auth): Hono {
  const app = new Hono();
  const scheduler: Scheduler = { add: async () => {} };
  const storage: Storage = {
    upload: async () => {},
    download: async () => new Uint8Array(),
    getUrl: () => '/test',
    delete: async () => {},
  };

  const http = {} as import('../http-client').HttpClient;

  app.onError(errorHandler);
  app.use('*', contextMiddleware({ db, scheduler, storage, http }));
  app.route('/api/system', createSystemRoutes(auth));

  return app;
}

describe('system module handlers', () => {
  let sqlite: Database;
  let db: VobaseDb;
  let app: Hono;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.run('PRAGMA journal_mode=WAL');
    sqlite.exec(`
      CREATE TABLE _audit_log (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        actor_id TEXT,
        actor_email TEXT,
        ip TEXT,
        details TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE _sequences (
        id TEXT PRIMARY KEY,
        prefix TEXT NOT NULL UNIQUE,
        current_value INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE _record_audits (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        old_data TEXT,
        new_data TEXT,
        changed_by TEXT,
        created_at INTEGER NOT NULL
      );

      INSERT INTO _audit_log (id, event, actor_id, actor_email, ip, details, created_at)
      VALUES
        ('log_1', 'signin', 'user_1', 'user@example.com', '127.0.0.1', '{}', 1000),
        ('log_2', 'signout', 'user_1', 'user@example.com', '127.0.0.1', '{}', 2000),
        ('log_3', 'api_mutation', 'user_1', 'user@example.com', '127.0.0.1', '{"path":"/api/foo"}', 3000);

      INSERT INTO _sequences (id, prefix, current_value, updated_at)
      VALUES
        ('seq_1', 'INV', 12, 3000),
        ('seq_2', 'ORD', 5, 2000);

      INSERT INTO _record_audits (id, table_name, record_id, old_data, new_data, changed_by, created_at)
      VALUES
        (
          'rec_1',
          'invoices',
          'inv_1',
          '{"status":"draft"}',
          '{"status":"sent"}',
          'user_1',
          4000
        );
    `);

    db = drizzle(sqlite, { schema }) as unknown as VobaseDb;
    app = createSystemTestApp(db, createAuthStub());
  });

  afterEach(() => {
    sqlite.close();
  });

  it('GET /api/system/ returns system info', async () => {
    const response = await app.request('http://localhost/api/system', {
      headers: { authorization: AUTHORIZATION_HEADER },
    });
    const body = (await response.json()) as {
      version: string;
      uptime: number;
      modules: string[];
    };

    expect(response.status).toBe(200);
    expect(typeof body.version).toBe('string');
    expect(typeof body.uptime).toBe('number');
    expect(Array.isArray(body.modules)).toBe(true);
    expect(body.modules).toContain('system');
  });

  it('GET /api/system/health returns detailed health payload', async () => {
    const response = await app.request('http://localhost/api/system/health', {
      headers: { authorization: AUTHORIZATION_HEADER },
    });
    const body = (await response.json()) as {
      status: string;
      db: string;
      uptime: number;
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });

  it('GET /api/system/audit-log supports auth + cursor pagination', async () => {
    const firstPage = await app.request(
      'http://localhost/api/system/audit-log?limit=2',
      {
        headers: { authorization: AUTHORIZATION_HEADER },
      },
    );
    const firstPageBody = (await firstPage.json()) as {
      entries: Array<{ id: string }>;
      nextCursor: string | null;
    };

    expect(firstPage.status).toBe(200);
    expect(firstPageBody.entries).toHaveLength(2);
    expect(firstPageBody.entries[0]?.id).toBe('log_3');
    expect(firstPageBody.entries[1]?.id).toBe('log_2');
    expect(typeof firstPageBody.nextCursor).toBe('string');

    const secondPage = await app.request(
      `http://localhost/api/system/audit-log?limit=2&cursor=${firstPageBody.nextCursor}`,
      { headers: { authorization: AUTHORIZATION_HEADER } },
    );
    const secondPageBody = (await secondPage.json()) as {
      entries: Array<{ id: string }>;
      nextCursor: string | null;
    };

    expect(secondPage.status).toBe(200);
    expect(secondPageBody.entries).toHaveLength(1);
    expect(secondPageBody.entries[0]?.id).toBe('log_1');
    expect(secondPageBody.nextCursor).toBeNull();
  });

  it('GET /api/system/sequences returns sequence counters', async () => {
    const response = await app.request(
      'http://localhost/api/system/sequences',
      {
        headers: { authorization: AUTHORIZATION_HEADER },
      },
    );
    const body = (await response.json()) as {
      sequences: Array<{ prefix: string; currentValue: number }>;
    };

    expect(response.status).toBe(200);
    expect(body.sequences).toHaveLength(2);
    expect(body.sequences[0]?.prefix).toBe('INV');
    expect(body.sequences[0]?.currentValue).toBe(12);
  });

  it('GET /api/system/record-audits/:table/:id returns record history', async () => {
    const response = await app.request(
      'http://localhost/api/system/record-audits/invoices/inv_1',
      {
        headers: { authorization: AUTHORIZATION_HEADER },
      },
    );
    const body = (await response.json()) as {
      entries: Array<{ tableName: string; recordId: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.tableName).toBe('invoices');
    expect(body.entries[0]?.recordId).toBe('inv_1');
  });

  it('returns 401 for unauthenticated requests', async () => {
    const response = await app.request('http://localhost/api/system/audit-log');
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
