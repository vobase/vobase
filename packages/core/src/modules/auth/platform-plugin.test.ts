import { beforeAll, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/pglite';
import { SignJWT } from 'jose';

import { createTestPGlite } from '../../test-helpers';
import { platformAuth } from './platform-plugin';
import { apikeyTableMap, authTableMap } from './schema';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------
const BASE_URL = 'http://localhost:3000';
// better-auth appends /api/auth to baseURL — this is what ctx.context.baseURL resolves to
// and therefore what jwtVerify checks as the audience.
const AUTH_AUDIENCE = `${BASE_URL}/api/auth`;
const HMAC_SECRET = 'test-hmac-secret-32-bytes-minimum!';
const secretKey = new TextEncoder().encode(HMAC_SECRET);

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------
interface JwtOptions {
  audience?: string;
  /** Set to true to produce an already-expired token */
  expired?: boolean;
  profile?: Record<string, unknown>;
  provider?: string;
}

async function createTestJWT(opts: JwtOptions = {}): Promise<string> {
  const {
    audience = AUTH_AUDIENCE,
    expired = false,
    profile = {
      email: 'alice@example.com',
      name: 'Alice',
      picture: 'https://example.com/alice.png',
      providerId: 'alice-provider-id',
    },
    provider = 'github',
  } = opts;

  const builder = new SignJWT({ profile, provider })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(audience);

  if (expired) {
    // Set expiry to 10 seconds in the past
    builder.setExpirationTime(new Date(Date.now() - 10_000));
  } else {
    builder.setExpirationTime('5m');
  }

  return builder.sign(secretKey);
}

// ---------------------------------------------------------------------------
// Database bootstrap – minimal tables required by better-auth
// ---------------------------------------------------------------------------
async function createTestDatabase() {
  const pg = await createTestPGlite();
  await pg.exec(`
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
      "user_id" TEXT NOT NULL REFERENCES "auth"."user" ("id") ON DELETE CASCADE
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
      "name" TEXT,
      "start" TEXT,
      "prefix" TEXT,
      "key" TEXT NOT NULL,
      "user_id" TEXT NOT NULL REFERENCES "auth"."user" ("id") ON DELETE CASCADE,
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
  `);
  return { pg, db: drizzle({ client: pg }) };
}

// ---------------------------------------------------------------------------
// Auth instance factory
// ---------------------------------------------------------------------------
function createTestAuth(db: ReturnType<typeof drizzle>) {
  return betterAuth({
    baseURL: BASE_URL,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { ...authTableMap, ...apikeyTableMap },
    }),
    emailAndPassword: { enabled: true },
    user: {
      additionalFields: {
        role: { type: 'string', defaultValue: 'user', input: false },
      },
    },
    plugins: [platformAuth({ hmacSecret: HMAC_SECRET })],
  });
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------
function callbackUrl(token: string, returnTo?: string): string {
  const url = new URL(`${BASE_URL}/api/auth/platform-callback`);
  url.searchParams.set('token', token);
  if (returnTo !== undefined) url.searchParams.set('returnTo', returnTo);
  return url.toString();
}

async function hitCallback(
  auth: ReturnType<typeof createTestAuth>,
  token: string,
  returnTo?: string,
): Promise<Response> {
  return auth.handler(
    new Request(callbackUrl(token, returnTo), { method: 'GET' }),
  );
}

// ---------------------------------------------------------------------------
// Query helpers – inspect PGlite state after requests
// ---------------------------------------------------------------------------
async function queryUsers(pg: PGlite) {
  const result = await pg.query<{ id: string; email: string; name: string }>(
    'SELECT id, email, name FROM "auth"."user" ORDER BY created_at',
  );
  return result.rows;
}

async function queryAccounts(pg: PGlite) {
  const result = await pg.query<{
    user_id: string;
    provider_id: string;
    account_id: string;
  }>(
    'SELECT user_id, provider_id, account_id FROM "auth"."account" ORDER BY created_at',
  );
  return result.rows;
}

// ===========================================================================
// Shared test database (single PGlite instance for all describe blocks)
// ===========================================================================
let sharedPg: PGlite;
let sharedAuth: ReturnType<typeof createTestAuth>;

beforeAll(async () => {
  const setup = await createTestDatabase();
  sharedPg = setup.pg;
  sharedAuth = createTestAuth(setup.db);
  // Warmup: ensure better-auth + PGlite are fully operational before tests
  await sharedPg.query('SELECT 1');
});

// Never close the shared PGlite — process exit handles cleanup

// ===========================================================================
// Tests
// ===========================================================================

describe('platformAuth plugin – JWT verification', () => {
  it('valid token proceeds (redirects after session creation)', async () => {
    const token = await createTestJWT();
    const res = await hitCallback(sharedAuth, token);
    expect(res.status).toBe(302);
  });

  it('expired token returns 400', async () => {
    const token = await createTestJWT({ expired: true });
    const res = await hitCallback(sharedAuth, token);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('Invalid or expired token');
  });

  it('wrong audience returns 400', async () => {
    const token = await createTestJWT({ audience: 'http://attacker.com' });
    const res = await hitCallback(sharedAuth, token);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('Invalid or expired token');
  });

  it('wrong secret returns 400', async () => {
    const wrongKey = new TextEncoder().encode(
      'totally-wrong-secret-32-bytes!!',
    );
    const token = await new SignJWT({
      profile: { email: 'bad@example.com', name: 'Bad', providerId: 'bad-id' },
      provider: 'github',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience(AUTH_AUDIENCE)
      .setExpirationTime('5m')
      .sign(wrongKey);

    const res = await hitCallback(sharedAuth, token);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('Invalid or expired token');
  });

  it('malformed / garbage token returns 400', async () => {
    const res = await hitCallback(sharedAuth, 'not.a.valid.jwt.at.all');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('Invalid or expired token');
  });
});

describe('platformAuth plugin – payload validation', () => {
  it('token without email in profile returns 400', async () => {
    const token = await createTestJWT({
      profile: { name: 'No Email', providerId: 'noemail-id' },
    });
    const res = await hitCallback(sharedAuth, token);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('Invalid token payload');
  });

  it('token without provider field returns 400', async () => {
    const token = await new SignJWT({
      profile: {
        email: 'noprov@example.com',
        name: 'No Provider',
        providerId: 'np-id',
      },
      // provider intentionally omitted
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience(AUTH_AUDIENCE)
      .setExpirationTime('5m')
      .sign(secretKey);

    const res = await hitCallback(sharedAuth, token);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('Invalid token payload');
  });
});

describe('platformAuth plugin – user upsert', () => {
  it('new user: creates user row and account row', async () => {
    const token = await createTestJWT({
      profile: {
        email: 'newuser@example.com',
        name: 'New User',
        providerId: 'new-provider-id',
      },
      provider: 'github',
    });

    const res = await hitCallback(sharedAuth, token);
    expect(res.status).toBe(302);

    const users = await queryUsers(sharedPg);
    const accounts = await queryAccounts(sharedPg);

    const user = users.find((u) => u.email === 'newuser@example.com');
    expect(user).toBeDefined();
    expect(user?.name).toBe('New User');

    const account = accounts.find(
      (a) => a.provider_id === 'github' && a.account_id === 'new-provider-id',
    );
    expect(account).toBeDefined();
    expect(account?.user_id).toBe(user?.id);
  });

  it('existing user with different provider: links new account', async () => {
    const email = `multiauth-${Date.now()}@example.com`;

    const firstToken = await createTestJWT({
      profile: { email, name: 'Multi Auth', providerId: 'github-multi-id' },
      provider: 'github',
    });
    await hitCallback(sharedAuth, firstToken);

    const secondToken = await createTestJWT({
      profile: { email, name: 'Multi Auth', providerId: 'google-multi-id' },
      provider: 'google',
    });
    await hitCallback(sharedAuth, secondToken);

    const accounts = await queryAccounts(sharedPg);
    const userAccounts = accounts.filter(
      (a) =>
        (a.provider_id === 'github' && a.account_id === 'github-multi-id') ||
        (a.provider_id === 'google' && a.account_id === 'google-multi-id'),
    );

    expect(userAccounts).toHaveLength(2);
    const userIds = [...new Set(userAccounts.map((a) => a.user_id))];
    expect(userIds).toHaveLength(1);
  });

  it('existing user + existing account: no duplicate account created', async () => {
    const email = `dedup-${Date.now()}@example.com`;
    const profile = {
      email,
      name: 'Dedup User',
      providerId: 'dedup-provider-id',
    };

    const token1 = await createTestJWT({ profile, provider: 'github' });
    await hitCallback(sharedAuth, token1);

    const token2 = await createTestJWT({ profile, provider: 'github' });
    await hitCallback(sharedAuth, token2);

    const accounts = await queryAccounts(sharedPg);
    const deduped = accounts.filter(
      (a) => a.provider_id === 'github' && a.account_id === 'dedup-provider-id',
    );

    expect(deduped).toHaveLength(1);
  });
});

describe('platformAuth plugin – returnTo redirect', () => {
  async function getRedirectLocation(
    token: string,
    returnTo?: string,
  ): Promise<string> {
    const res = await hitCallback(sharedAuth, token, returnTo);
    expect(res.status).toBe(302);
    return res.headers.get('location') ?? '';
  }

  it('valid relative path: redirects to that path', async () => {
    const token = await createTestJWT({
      profile: {
        email: `rt-valid-${Date.now()}@example.com`,
        name: 'ReturnTo Valid',
        providerId: `rt-valid-${Date.now()}`,
      },
    });
    const location = await getRedirectLocation(token, '/dashboard');
    expect(location).toBe('/dashboard');
  });

  it('absolute URL: redirects to /', async () => {
    const token = await createTestJWT({
      profile: {
        email: `rt-abs-${Date.now()}@example.com`,
        name: 'ReturnTo Abs',
        providerId: `rt-abs-${Date.now()}`,
      },
    });
    const location = await getRedirectLocation(token, 'https://evil.com/steal');
    expect(location).toBe('/');
  });

  it('protocol-relative //evil.com: redirects to /', async () => {
    const token = await createTestJWT({
      profile: {
        email: `rt-proto-${Date.now()}@example.com`,
        name: 'ReturnTo Proto',
        providerId: `rt-proto-${Date.now()}`,
      },
    });
    const location = await getRedirectLocation(token, '//evil.com/steal');
    expect(location).toBe('/');
  });

  it('missing returnTo: redirects to /', async () => {
    const token = await createTestJWT({
      profile: {
        email: `rt-missing-${Date.now()}@example.com`,
        name: 'ReturnTo Missing',
        providerId: `rt-missing-${Date.now()}`,
      },
    });
    const location = await getRedirectLocation(token);
    expect(location).toBe('/');
  });
});
