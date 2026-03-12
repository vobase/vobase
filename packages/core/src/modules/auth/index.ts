import { Hono } from 'hono';
import { betterAuth } from 'better-auth';
import type { SocialProviders } from 'better-auth/social-providers';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import type { AuthAdapter } from '../../contracts/auth';
import type { VobaseDb } from '../../db/client';
import { defineBuiltinModule } from '../../module';
import type { VobaseModule } from '../../module';
import { authSchema } from './schema';
import { createAuthAuditHooks } from './audit-hooks';

export interface AuthModuleConfig {
  baseURL?: string;
  trustedOrigins?: string[];
  socialProviders?: SocialProviders;
}

export type AuthModule = VobaseModule & { adapter: AuthAdapter };

export function createAuthModule(db: VobaseDb, config?: AuthModuleConfig): AuthModule {
  const baseURL = config?.baseURL ?? process.env.BETTER_AUTH_URL;

  const auth = betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    ...(baseURL && { baseURL }),
    emailAndPassword: {
      enabled: true,
    },
    ...(config?.socialProviders && { socialProviders: config.socialProviders }),
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
    ...(config?.trustedOrigins && { trustedOrigins: config.trustedOrigins }),
  });

  const adapter: AuthAdapter = {
    getSession: (headers) => auth.api.getSession({ headers }),
    handler: (request) => auth.handler(request),
  };

  const mod = defineBuiltinModule({
    name: '_auth',
    schema: authSchema,
    routes: new Hono(),
  });

  return { ...mod, adapter };
}

export { authSchema } from './schema';
export { sessionMiddleware, optionalSessionMiddleware } from './middleware';
export { createAuthAuditHooks } from './audit-hooks';
