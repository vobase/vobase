/**
 * Seed script — creates a default admin user, then calls each module's seed function.
 * Module seed data lives in modules/{name}/seed.ts.
 *
 * createApp() starts a bunqueue worker that processes jobs automatically.
 * KB documents are uploaded via the API → job queue processes them → we wait for completion.
 *
 * Usage: bun run seed
 */
import { resolve } from 'node:path';
import { createApp, createDatabase } from '@vobase/core';
import { sql } from 'drizzle-orm';

import { setupSqliteVec } from '../lib/sqlite-vec';
import { modules } from '../modules';
import { seedMessaging } from '../modules/messaging/seed';
import { seedKnowledgeBase } from '../modules/knowledge-base/seed';
import config from '../vobase.config';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'Admin@vobase1';
const ADMIN_NAME = 'Admin';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

// Must happen before any Database is opened
setupSqliteVec();

const dbPath = resolve(config.database);

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
// Open a read-only Drizzle connection for checking existing data + messaging inserts
const db = createDatabase(dbPath);

if (!userId) {
  const rows = db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`);
  userId = rows[0]?.id ?? 'seed-admin';
}

// KB: upload fixtures via API → bunqueue worker processes them (extract → chunk → embed)
const kbCount = await seedKnowledgeBase(app, sessionCookie, db);
if (kbCount > 0)
  console.log(`${green('✓')} Processed ${kbCount} KB documents from fixtures`);
else console.log(dim('✓ KB documents already exist. Skipping.'));

// Messaging: direct Drizzle inserts (no async pipeline needed)
const msgResult = seedMessaging(db, userId);
if (msgResult.agents > 0) {
  console.log(
    green('✓') +
      ` Created ${msgResult.agents} messaging agents + ${msgResult.threads} sample thread with messages`,
  );
} else {
  console.log(dim('✓ Messaging data already exists. Skipping.'));
}

process.exit(0);
