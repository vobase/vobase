import { rmSync } from 'node:fs';
import type { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { shutdownManager } from 'bunqueue/client';

import { createApp } from '../app';
import { createAuth } from '../auth';
import { createDatabase, type VobaseDb } from '../db';
import { createSystemModule } from '../system';

type DbWithClient = VobaseDb & { $client: Database };

const dbPath = `/tmp/vobase-e2e-${process.pid}-${Date.now()}.db`;
const queueDbPath = dbPath.replace(/\.db$/, '-queue.db');
const email = `e2e-${Date.now()}@test.com`;
const password = 'Test1234!';

let app: ReturnType<typeof createApp>;
let systemDb: DbWithClient;
let sessionCookie = '';
let previousAuthSecret: string | undefined;
let previousAuthUrl: string | undefined;

const getPragmaValue = (db: DbWithClient, pragma: string): string => {
  const row = db.$client.query(`PRAGMA ${pragma}`).get() as Record<
    string,
    unknown
  >;
  return String(Object.values(row)[0]);
};

beforeAll(() => {
  previousAuthSecret = process.env.BETTER_AUTH_SECRET;
  previousAuthUrl = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_SECRET = 'vobase-e2e-secret';
  process.env.BETTER_AUTH_URL = 'http://localhost';

  systemDb = createDatabase(dbPath) as DbWithClient;
  app = createApp({
    database: dbPath,
    modules: [createSystemModule(createAuth(systemDb))],
    mcp: { enabled: true },
  });
});

afterAll(() => {
  shutdownManager();
  systemDb?.$client.close();
  if (previousAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = previousAuthSecret;
  if (previousAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = previousAuthUrl;

  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  rmSync(queueDbPath, { force: true });
  rmSync(`${queueDbPath}-wal`, { force: true });
  rmSync(`${queueDbPath}-shm`, { force: true });
  rmSync('./data/bunqueue.db', { force: true });
  rmSync('./data/bunqueue.db-wal', { force: true });
  rmSync('./data/bunqueue.db-shm', { force: true });
});

describe('vobase engine e2e integration', () => {
  it('passes health, auth, system, mcp, and db pragma checks', async () => {
    const health = await app.request('http://localhost/health');
    const healthBody = (await health.json()) as {
      status: string;
      uptime: number;
    };
    expect(health.status).toBe(200);
    expect(healthBody).toMatchObject({ status: 'ok' });
    expect(typeof healthBody.uptime).toBe('number');

    const signup = await app.request(
      'http://localhost/api/auth/sign-up/email',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: 'E2E Test' }),
      },
    );
    const signupBody = (await signup.json()) as { user?: { email?: string } };
    expect(signup.status).toBe(200);
    expect(signupBody.user?.email).toBe(email);

    const signin = await app.request(
      'http://localhost/api/auth/sign-in/email',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      },
    );
    expect(signin.status).toBe(200);
    sessionCookie =
      (signin.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(sessionCookie.length).toBeGreaterThan(0);

    const systemInfo = await app.request('http://localhost/api/system', {
      headers: { cookie: sessionCookie },
    });
    const infoBody = (await systemInfo.json()) as {
      version: string;
      uptime: number;
      modules: string[];
    };
    expect(systemInfo.status).toBe(200);
    expect(typeof infoBody.version).toBe('string');
    expect(typeof infoBody.uptime).toBe('number');
    expect(infoBody.modules).toContain('system');

    const audit = await app.request('http://localhost/api/system/audit-log', {
      headers: { cookie: sessionCookie },
    });
    expect(audit.status).toBe(200);
    expect(
      Array.isArray(((await audit.json()) as { entries: unknown[] }).entries),
    ).toBe(true);

    const mcp = await app.request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });
    expect(mcp.status).toBe(200);
    expect(
      Array.isArray(
        ((await mcp.json()) as { result?: { tools?: unknown[] } }).result
          ?.tools,
      ),
    ).toBe(true);

    expect({
      journalMode: getPragmaValue(systemDb, 'journal_mode'),
      busyTimeout: getPragmaValue(systemDb, 'busy_timeout'),
      synchronous: getPragmaValue(systemDb, 'synchronous'),
      foreignKeys: getPragmaValue(systemDb, 'foreign_keys'),
    }).toEqual({
      journalMode: 'wal',
      busyTimeout: '5000',
      synchronous: '1',
      foreignKeys: '1',
    });
  });
});
