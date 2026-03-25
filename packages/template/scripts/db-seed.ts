/**
 * Seed script — creates a default admin user, then calls each module's seed function.
 * Module seed data lives in modules/{name}/seed.ts.
 *
 * Auto-discovery: any module with a seed.ts that exports a default function
 * will be called automatically. No manual registration needed.
 *
 * Seed contract: export default async function seed(ctx: SeedContext): Promise<void>
 * where SeedContext = { app, db, sessionCookie, userId }
 *
 * createApp() starts a worker that processes jobs automatically.
 * KB documents are uploaded via the API → job queue processes them → we wait for completion.
 *
 * Usage: bun run seed
 */
import { join } from 'node:path';
import { authUser, createApp, createDatabase } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { modules } from '../modules';
import config from '../vobase.config';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'Admin@vobase1';
const ADMIN_NAME = 'Admin';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const dbUrl = config.database;

// createApp starts scheduler + worker — jobs enqueued here get processed automatically
const app = await createApp({ ...config, modules });

// --- 1. Admin user ---
let userId: string | undefined;
let sessionCookie = '';

const authRes = await app.request('http://localhost/api/auth/sign-up/email', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    name: ADMIN_NAME,
  }),
});

if (authRes.status === 200) {
  const data = (await authRes.json()) as { user?: { id: string } };
  userId = data.user?.id;
  sessionCookie = authRes.headers.get('set-cookie') ?? '';
  // Set admin role on the seed user
  if (userId) {
    const db = createDatabase(dbUrl);
    await db
      .update(authUser)
      .set({ role: 'admin' })
      .where(eq(authUser.id, userId));
  }
  console.log(`${green('✓')} Created user: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(dim('  Pre-filled on the login page in dev mode'));
} else {
  const body = (await authRes.json().catch(() => null)) as {
    code?: string;
  } | null;
  if (body?.code?.startsWith('USER_ALREADY_EXISTS')) {
    console.log(dim(`✓ User ${ADMIN_EMAIL} already exists. Skipping.`));
  } else {
    console.error(
      `Failed to create user (${authRes.status}): ${JSON.stringify(body)}`,
    );
    process.exit(1);
  }
}

// Sign in to get session cookie (needed for authenticated API calls)
if (!sessionCookie) {
  const loginRes = await app.request(
    'http://localhost/api/auth/sign-in/email',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    },
  );
  if (loginRes.ok) {
    const data = (await loginRes.json()) as { user?: { id: string } };
    userId = data.user?.id;
    sessionCookie = loginRes.headers.get('set-cookie') ?? '';
  }
}

// --- 2. Module seeds ---
const db = createDatabase(dbUrl);

if (!userId) {
  const rows = await db.select({ id: authUser.id }).from(authUser).limit(1);
  userId = rows[0]?.id ?? 'seed-admin';
}

// Auto-discover seed files: any modules/{name}/seed.ts with a default export
const modulesDir = join(import.meta.dir, '..', 'modules');
const glob = new Bun.Glob('*/seed.ts');
const seedFiles = Array.from(glob.scanSync(modulesDir)).sort();

const ctx = { app, db, sessionCookie, userId };

for (const seedFile of seedFiles) {
  const seedPath = join(modulesDir, seedFile);
  const mod = await import(seedPath);
  if (typeof mod.default === 'function') {
    await mod.default(ctx);
  }
}

process.exit(0);
