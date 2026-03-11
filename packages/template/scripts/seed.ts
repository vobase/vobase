/**
 * Seed script — creates a default admin user for development.
 *
 * Usage: bun run seed
 */
import { createApp } from '@vobase/core';
import { modules } from '../modules';
import config from '../vobase.config';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'Admin@vobase1';
const ADMIN_NAME = 'Admin';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const app = createApp({ ...config, modules });

const res = await app.request(
  'http://localhost/api/auth/sign-up/email',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      name: ADMIN_NAME,
    }),
  },
);

if (res.status === 200) {
  console.log(green('✓') + ` Created user: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(dim('  Pre-filled on the login page in dev mode'));
} else {
  const body = await res.json().catch(() => null) as { code?: string } | null;
  if (body?.code?.startsWith('USER_ALREADY_EXISTS')) {
    console.log(dim(`✓ User ${ADMIN_EMAIL} already exists. Skipping.`));
  } else {
    console.error(`Failed to create user (${res.status}): ${JSON.stringify(body)}`);
    process.exit(1);
  }
}

process.exit(0);
