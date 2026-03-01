import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import type { VobaseDb } from './db';
import { authSchema } from './db/auth-schema';
import { createAuthAuditHooks } from './middleware/audit';

export interface CreateAuthOptions {
  trustedOrigins?: string[];
}

export function createAuth(db: VobaseDb, options?: CreateAuthOptions) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
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
    ...(options?.trustedOrigins && { trustedOrigins: options.trustedOrigins }),
  });
}

export type Auth = ReturnType<typeof createAuth>;
