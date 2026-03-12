import { rmSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { shutdownManager } from 'bunqueue/client';

import { createApp } from '../app';
import { createDatabase, type VobaseDb } from '../db';
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

/**
 * Create all required tables for the e2e test.
 * Since ensureCoreTables() was removed, we create tables via raw SQL
 * matching the Drizzle schema definitions.
 */
function createTables(db: Database) {
  db.run(`CREATE TABLE IF NOT EXISTS "user" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "email" text NOT NULL,
    "email_verified" integer NOT NULL DEFAULT 0,
    "image" text,
    "role" text NOT NULL DEFAULT 'user',
    "created_at" integer NOT NULL,
    "updated_at" integer NOT NULL
  )`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS "user_email_unique" ON "user" ("email")`);

  db.run(`CREATE TABLE IF NOT EXISTS "session" (
    "id" text PRIMARY KEY NOT NULL,
    "expires_at" integer NOT NULL,
    "token" text NOT NULL,
    "created_at" integer NOT NULL,
    "updated_at" integer NOT NULL,
    "ip_address" text,
    "user_agent" text,
    "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
  )`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS "session_token_unique" ON "session" ("token")`);
  db.run(`CREATE INDEX IF NOT EXISTS "session_user_id_idx" ON "session" ("user_id")`);

  db.run(`CREATE TABLE IF NOT EXISTS "account" (
    "id" text PRIMARY KEY NOT NULL,
    "account_id" text NOT NULL,
    "provider_id" text NOT NULL,
    "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "access_token" text,
    "refresh_token" text,
    "id_token" text,
    "access_token_expires_at" integer,
    "refresh_token_expires_at" integer,
    "scope" text,
    "password" text,
    "created_at" integer NOT NULL,
    "updated_at" integer NOT NULL
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS "account_user_id_idx" ON "account" ("user_id")`);

  db.run(`CREATE TABLE IF NOT EXISTS "verification" (
    "id" text PRIMARY KEY NOT NULL,
    "identifier" text NOT NULL,
    "value" text NOT NULL,
    "expires_at" integer NOT NULL,
    "created_at" integer NOT NULL,
    "updated_at" integer NOT NULL
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier")`);

  db.run(`CREATE TABLE IF NOT EXISTS "_audit_log" (
    "id" text PRIMARY KEY NOT NULL,
    "event" text NOT NULL,
    "actor_id" text,
    "actor_email" text,
    "ip" text,
    "details" text,
    "created_at" integer NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS "_record_audits" (
    "id" text PRIMARY KEY NOT NULL,
    "table_name" text NOT NULL,
    "record_id" text NOT NULL,
    "old_data" text,
    "new_data" text,
    "changed_by" text,
    "created_at" integer NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS "_sequences" (
    "id" text PRIMARY KEY NOT NULL,
    "prefix" text NOT NULL,
    "current_value" integer NOT NULL DEFAULT 0,
    "updated_at" integer NOT NULL
  )`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS "_sequences_prefix_unique" ON "_sequences" ("prefix")`);

  db.run(`CREATE TABLE IF NOT EXISTS "_webhook_dedup" (
    "id" text NOT NULL,
    "source" text NOT NULL,
    "received_at" integer NOT NULL,
    PRIMARY KEY ("id", "source")
  )`);
}

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

  // Create tables before createApp opens its own connection
  const bootstrapDb = new Database(dbPath);
  createTables(bootstrapDb);
  bootstrapDb.close();

  systemDb = createDatabase(dbPath) as DbWithClient;
  app = createApp({
    database: dbPath,
    modules: [],
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
  it('passes health, auth, mcp, and db pragma checks', async () => {
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
