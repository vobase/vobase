import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { vector } from '@electric-sql/pglite/vector';

import { createApp } from '../app';

const tempDir = `/tmp/vobase-e2e-${process.pid}-${Date.now()}`;
const nanoidSql = readFileSync(
  join(import.meta.dir, '../../../template/db/extensions/03_nanoid.sql'),
  'utf-8',
);

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

  await run('CREATE SCHEMA IF NOT EXISTS "auth"');
  await run('CREATE SCHEMA IF NOT EXISTS "audit"');
  await run('CREATE SCHEMA IF NOT EXISTS "infra"');

  await run(`
    CREATE TABLE IF NOT EXISTS "auth"."user" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "name" TEXT NOT NULL,
      "email" TEXT NOT NULL UNIQUE,
      "email_verified" BOOLEAN NOT NULL DEFAULT FALSE,
      "image" TEXT,
      "role" TEXT NOT NULL DEFAULT 'user',
      "is_anonymous" BOOLEAN NOT NULL DEFAULT FALSE,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "auth"."session" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "expires_at" TIMESTAMPTZ NOT NULL,
      "token" TEXT NOT NULL UNIQUE,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "ip_address" TEXT,
      "user_agent" TEXT,
      "user_id" TEXT NOT NULL REFERENCES "auth"."user" ("id") ON DELETE CASCADE,
      "active_organization_id" TEXT
    );
    CREATE TABLE IF NOT EXISTS "auth"."account" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "account_id" TEXT NOT NULL,
      "provider_id" TEXT NOT NULL,
      "user_id" TEXT NOT NULL REFERENCES "auth"."user" ("id") ON DELETE CASCADE,
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
    CREATE TABLE IF NOT EXISTS "auth"."verification" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "identifier" TEXT NOT NULL,
      "value" TEXT NOT NULL,
      "expires_at" TIMESTAMPTZ NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "auth"."apikey" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "config_id" TEXT NOT NULL DEFAULT 'default',
      "name" TEXT,
      "start" TEXT,
      "reference_id" TEXT NOT NULL,
      "prefix" TEXT,
      "key" TEXT NOT NULL,
      "refill_interval" TEXT,
      "refill_amount" INTEGER,
      "last_refill_at" TIMESTAMPTZ,
      "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
      "rate_limit_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
      "rate_limit_time_window" INTEGER DEFAULT 86400000,
      "rate_limit_max" INTEGER DEFAULT 10,
      "request_count" INTEGER NOT NULL DEFAULT 0,
      "remaining" INTEGER,
      "last_request" TIMESTAMPTZ,
      "expires_at" TIMESTAMPTZ,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "permissions" TEXT,
      "metadata" TEXT
    );
    CREATE TABLE IF NOT EXISTS "audit"."audit_log" (
      "id" TEXT PRIMARY KEY DEFAULT nanoid(12) NOT NULL,
      "event" TEXT NOT NULL,
      "actor_id" TEXT,
      "actor_email" TEXT,
      "ip" TEXT,
      "details" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "audit"."record_audits" (
      "id" TEXT PRIMARY KEY DEFAULT nanoid(12) NOT NULL,
      "table_name" TEXT NOT NULL,
      "record_id" TEXT NOT NULL,
      "old_data" TEXT,
      "new_data" TEXT,
      "changed_by" TEXT,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "infra"."sequences" (
      "id" TEXT PRIMARY KEY DEFAULT nanoid(12) NOT NULL,
      "prefix" TEXT NOT NULL UNIQUE,
      "current_value" INTEGER NOT NULL DEFAULT 0,
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "infra"."webhook_dedup" (
      "id" TEXT NOT NULL,
      "source" TEXT NOT NULL,
      "received_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY ("id", "source")
    );
    CREATE TABLE IF NOT EXISTS "infra"."integrations" (
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

// PGlite + pg-boss flaky under parallel test load (electric-sql/pglite#324)
(process.env.CI ? describe.skip : describe)('vobase engine e2e integration', () => {
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

  it('auth anonymous sign-in works', async () => {
    const signin = await app.request(
      'http://localhost/api/auth/sign-in/anonymous',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
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
