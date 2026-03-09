import { betterAuth } from 'better-auth';
import type { SocialProviders } from 'better-auth/social-providers';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import type { VobaseDb } from './db';
import { authSchema } from './db/auth-schema';
import { createAuthAuditHooks } from './middleware/audit';

export interface CreateAuthOptions {
  baseURL?: string;
  trustedOrigins?: string[];
  socialProviders?: SocialProviders;
}

export function createAuth(db: VobaseDb, options?: CreateAuthOptions) {
  const baseURL = options?.baseURL ?? process.env.BETTER_AUTH_URL;
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    ...(baseURL && { baseURL }),
    emailAndPassword: {
      enabled: true,
    },
    ...(options?.socialProviders && { socialProviders: options.socialProviders }),
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
