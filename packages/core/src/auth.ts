import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import type { VobaseDb } from './db';
import { createAuthAuditHooks } from './middleware/audit';

export function createAuth(db: VobaseDb) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite' }),
    emailAndPassword: {
      enabled: true,
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'user',
          input: false,
        },
      },
    },
    hooks: createAuthAuditHooks(db),
  });
}

export type Auth = ReturnType<typeof createAuth>;
