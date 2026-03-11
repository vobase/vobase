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

const app = createApp({ ...config, modules });

// Check if user already exists
const check = await app.request(
  'http://localhost/api/auth/sign-in/email',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  },
);

if (check.status === 200) {
  console.log(`User ${ADMIN_EMAIL} already exists. Skipping.`);
  process.exit(0);
}

// Create the admin user via better-auth sign-up API
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

if (res.status !== 200) {
  const body = await res.text();
  console.error(`Failed to create user (${res.status}): ${body}`);
  process.exit(1);
}

console.log(`Created user: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
console.log('(These credentials are pre-filled on the login page in dev mode)');
process.exit(0);
