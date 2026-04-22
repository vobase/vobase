/**
 * Better-auth config for CLI schema generation.
 *
 * Usage:
 *   bunx @better-auth/cli@latest generate --config packages/core/auth.ts --output packages/core/src/modules/auth/schema.generated.ts
 *
 * Uses in-memory PGlite so the CLI works without a running Postgres.
 * The generated schema uses pgTable() — the production schema uses
 * authPgSchema.table(). See schema.ts for the production version.
 *
 * Plugins and user fields come from config.ts — single source of truth.
 */
import { PGlite } from '@electric-sql/pglite';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/pglite';

import { createNanoid } from './src/db/helpers';
import { authUserFields, getAuthPlugins } from './src/modules/auth/config';

const client = new PGlite();
const db = drizzle({ client });

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: authUserFields,
  },
  plugins: getAuthPlugins(),
  advanced: {
    database: { generateId: () => createNanoid()() },
  },
});
