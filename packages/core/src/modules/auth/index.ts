import { Hono } from 'hono';
import { betterAuth } from 'better-auth';
import type { SocialProviders } from 'better-auth/social-providers';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { apiKey } from '@better-auth/api-key';
import { organization } from 'better-auth/plugins';

import type { AuthAdapter } from '../../contracts/auth';
import type { VobaseDb } from '../../db/client';
import { defineBuiltinModule } from '../../module';
import type { VobaseModule } from '../../module';
import { authSchema, apikeySchema, organizationSchema } from './schema';
import { createAuthAuditHooks } from './audit-hooks';
import { setOrganizationEnabled } from './permissions';

export interface AuthModuleConfig {
  baseURL?: string;
  trustedOrigins?: string[];
  socialProviders?: SocialProviders;
  /** Enable the organization plugin for multi-tenant support. Default: false */
  organization?: boolean;
}

export type AuthModule = VobaseModule & {
  adapter: AuthAdapter;
  /** Validate an API key and return the owning user. Returns null if invalid. */
  verifyApiKey: (key: string) => Promise<{ userId: string } | null>;
  /** Whether the organization plugin is enabled */
  organizationEnabled: boolean;
};

export function createAuthModule(db: VobaseDb, config?: AuthModuleConfig): AuthModule {
  const baseURL = config?.baseURL ?? process.env.BETTER_AUTH_URL;
  const orgEnabled = config?.organization ?? false;

  // Tell the permission middleware whether org is enabled
  setOrganizationEnabled(orgEnabled);

  // Build plugin list
  const plugins: any[] = [apiKey()];
  if (orgEnabled) {
    plugins.push(organization());
  }

  // Build schema for the adapter — always includes apikey, conditionally includes org
  const adapterSchema = {
    ...authSchema,
    ...apikeySchema,
    ...(orgEnabled ? organizationSchema : {}),
  };

  const auth = betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema: adapterSchema }),
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
    plugins,
    hooks: createAuthAuditHooks(db),
    ...(config?.trustedOrigins && { trustedOrigins: config.trustedOrigins }),
  });

  const adapter: AuthAdapter = {
    getSession: (headers) => auth.api.getSession({ headers }),
    handler: (request) => auth.handler(request),
  };

  const verifyApiKey = async (key: string): Promise<{ userId: string } | null> => {
    try {
      const result = await (auth.api as any).verifyApiKey({ body: { key } });
      if (result && result.valid && result.key?.userId) {
        return { userId: result.key.userId };
      }
      return null;
    } catch {
      return null;
    }
  };

  const mod = defineBuiltinModule({
    name: '_auth',
    schema: adapterSchema,
    routes: new Hono(),
  });

  return { ...mod, adapter, verifyApiKey, organizationEnabled: orgEnabled };
}

export { authSchema } from './schema';
export { sessionMiddleware, optionalSessionMiddleware } from './middleware';
export { createAuthAuditHooks } from './audit-hooks';
