import type { ApiKey } from '@better-auth/api-key';
import { apiKey } from '@better-auth/api-key';
import type { BetterAuthPlugin, SocialProviders } from 'better-auth';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { Hono } from 'hono';

import type { AuthAdapter, AuthSession } from '../../contracts/auth';
import type { VobaseDb } from '../../db/client';
import type { VobaseModule } from '../../module';
import { defineBuiltinModule } from '../../module';
import { createAuthAuditHooks } from './audit-hooks';
import { setOrganizationEnabled } from './permissions';
import { platformAuth } from './platform-plugin';
import {
  apikeySchema,
  authSchema,
  organizationSchema,
} from './schema';

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

export function createAuthModule(
  db: VobaseDb,
  config?: AuthModuleConfig,
): AuthModule {
  const baseURL = config?.baseURL ?? process.env.BETTER_AUTH_URL;
  const orgEnabled = config?.organization ?? false;

  // Tell the permission middleware whether org is enabled
  setOrganizationEnabled(orgEnabled);

  // Build plugin list. The concrete return types of apiKey() and organization() are
  // structurally compatible with BetterAuthPlugin but TypeScript's deep conditional
  // type resolution makes the union assignment fail. Casting here is safe — both
  // plugins implement the BetterAuthPlugin interface at runtime.
  const plugins: BetterAuthPlugin[] = [apiKey() as BetterAuthPlugin];
  if (orgEnabled) {
    plugins.push(organization() as BetterAuthPlugin);
  }
  const platformSecret = process.env.PLATFORM_HMAC_SECRET;
  if (platformSecret) {
    plugins.push(platformAuth({ hmacSecret: platformSecret }) as BetterAuthPlugin);
  }

  // Build schema for the adapter — always includes apikey, conditionally includes org
  const adapterSchema = {
    ...authSchema,
    ...apikeySchema,
    ...(orgEnabled ? organizationSchema : {}),
  };

  const auth = betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema: adapterSchema }),
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
    // better-auth's getSession return type doesn't include additionalFields (role) in its
    // static types, but the value is present at runtime. Cast to AuthSession which includes role.
    getSession: (headers) =>
      auth.api.getSession({ headers }) as Promise<AuthSession | null>,
    handler: (request) => auth.handler(request),
  };

  // The apiKey() plugin adds verifyApiKey to auth.api at runtime, but the dynamic plugin
  // composition means TypeScript can't statically infer the merged API type. Cast to a
  // minimal interface rather than using `any`. ApiKey.referenceId holds the userId.
  type VerifyApiKeyResult = { valid: boolean; key: ApiKey | null };
  type AuthApiWithVerifyApiKey = typeof auth.api & {
    verifyApiKey: (opts: {
      body: { key: string };
    }) => Promise<VerifyApiKeyResult>;
  };

  const verifyApiKey = async (
    key: string,
  ): Promise<{ userId: string } | null> => {
    try {
      const result = await (auth.api as AuthApiWithVerifyApiKey).verifyApiKey({
        body: { key },
      });
      if (result?.valid && result.key?.referenceId) {
        return { userId: result.key.referenceId };
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

export { createAuthAuditHooks } from './audit-hooks';
export { optionalSessionMiddleware, sessionMiddleware } from './middleware';
export { authSchema } from './schema';
