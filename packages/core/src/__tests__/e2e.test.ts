import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { vector } from '@electric-sql/pglite/vector';

import { createApp } from '../app';

const tempDir = `/tmp/vobase-e2e-${process.pid}-${Date.now()}`;
const nanoidSql = readFileSync(
  join(import.meta.dir, '../../../template/db/extensions/nanoid.sql'),
  'utf-8',
);

const email = `e2e-${Date.now()}@test.com`;
const password = 'Test1234!';

let app: Awaited<ReturnType<typeof createApp>>;
let sessionCookie = '';
let previousAuthSecret: string | undefined;
let previousAuthUrl: string | undefined;

/**
 * Bootstrap a PGlite directory with all tables required by the app.
 * Called before createApp so the auth/audit tables exist when better-auth initialises.
 */
async function bootstrapDatabase(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });

  const pg = new PGlite(dir, { extensions: { pgcrypto, vector } });
  const run = pg.exec.bind(pg);

  await run('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await run('CREATE EXTENSION IF NOT EXISTS vector');
  await run(nanoidSql);

  await run(`
    CREATE TABLE IF NOT EXISTS "user" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "name" TEXT NOT NULL,
      "email" TEXT NOT NULL UNIQUE,
      "email_verified" BOOLEAN NOT NULL DEFAULT FALSE,
      "image" TEXT,
      "role" TEXT NOT NULL DEFAULT 'user',
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "session" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "expires_at" TIMESTAMPTZ NOT NULL,
      "token" TEXT NOT NULL UNIQUE,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "ip_address" TEXT,
      "user_agent" TEXT,
      "user_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS "account" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "account_id" TEXT NOT NULL,
      "provider_id" TEXT NOT NULL,
      "user_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
      "access_token" TEXT,
      "refresh_token" TEXT,
      "id_token" TEXT,
      "access_token_expires_at" TIMESTAMPTZ,
      "refresh_token_expires_at" TIMESTAMPTZ,
      "scope" TEXT,
      "password" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "verification" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "identifier" TEXT NOT NULL,
      "value" TEXT NOT NULL,
      "expires_at" TIMESTAMPTZ NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "apikey" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "name" TEXT,
      "start" TEXT,
      "prefix" TEXT,
      "key" TEXT NOT NULL,
      "user_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
      "refill_interval" TEXT,
      "refill_amount" INTEGER,
      "last_refill_at" TIMESTAMPTZ,
      "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
      "rate_limit_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
      "rate_limit_time_window" INTEGER,
      "rate_limit_max" INTEGER,
      "request_count" INTEGER NOT NULL DEFAULT 0,
      "remaining" INTEGER,
      "last_request" TIMESTAMPTZ,
      "expires_at" TIMESTAMPTZ,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "permissions" TEXT,
      "metadata" TEXT
    );
    CREATE TABLE IF NOT EXISTS "_audit_log" (
      "id" TEXT PRIMARY KEY DEFAULT nanoid(12) NOT NULL,
      "event" TEXT NOT NULL,
      "actor_id" TEXT,
      "actor_email" TEXT,
      "ip" TEXT,
      "details" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "_record_audits" (
      "id" TEXT PRIMARY KEY DEFAULT nanoid(12) NOT NULL,
      "table_name" TEXT NOT NULL,
      "record_id" TEXT NOT NULL,
      "old_data" TEXT,
      "new_data" TEXT,
      "changed_by" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "_sequences" (
      "id" TEXT PRIMARY KEY DEFAULT nanoid(12) NOT NULL,
      "prefix" TEXT NOT NULL UNIQUE,
      "current_value" INTEGER NOT NULL DEFAULT 0,
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "_webhook_dedup" (
      "id" TEXT NOT NULL,
      "source" TEXT NOT NULL,
      "received_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY ("id", "source")
    );
    CREATE TABLE IF NOT EXISTS "_integrations" (
      "id" TEXT PRIMARY KEY DEFAULT nanoid(12),
      "provider" TEXT NOT NULL,
      "auth_type" TEXT NOT NULL,
      "label" TEXT,
      "status" TEXT NOT NULL DEFAULT 'active',
      "config" TEXT NOT NULL,
      "scopes" TEXT,
      "config_expires_at" TIMESTAMPTZ,
      "last_refresh_at" TIMESTAMPTZ,
      "auth_failed_at" TIMESTAMPTZ,
      "created_by" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pg.close();
}

beforeAll(async () => {
  previousAuthSecret = process.env.BETTER_AUTH_SECRET;
  previousAuthUrl = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_SECRET = 'vobase-e2e-secret';
  process.env.BETTER_AUTH_URL = 'http://localhost';

  await bootstrapDatabase(tempDir);

  app = await createApp({
    database: tempDir,
    modules: [],
    mcp: { enabled: true },
  });
});

afterAll(() => {
  if (previousAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = previousAuthSecret;
  if (previousAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = previousAuthUrl;

  rmSync(tempDir, { force: true, recursive: true });
});

describe('vobase engine e2e integration', () => {
  it('health endpoint returns ok', async () => {
    const health = await app.request('http://localhost/health');
    const healthBody = (await health.json()) as {
      status: string;
      uptime: number;
    };
    expect(health.status).toBe(200);
    expect(healthBody).toMatchObject({ status: 'ok' });
    expect(typeof healthBody.uptime).toBe('number');
  });

  it('auth signup and signin work', async () => {
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
  });

  it('MCP tools/list returns tools array', async () => {
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
  });
});
