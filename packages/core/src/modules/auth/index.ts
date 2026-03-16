import { Hono } from 'hono';
import { betterAuth } from 'better-auth';
import type { BetterAuthPlugin, SocialProviders } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { apiKey } from '@better-auth/api-key';
import type { ApiKey } from '@better-auth/api-key';
import { organization } from 'better-auth/plugins';

import type { AuthAdapter, AuthSession } from '../../contracts/auth';
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

  // Build plugin list. The concrete return types of apiKey() and organization() are
  // structurally compatible with BetterAuthPlugin but TypeScript's deep conditional
  // type resolution makes the union assignment fail. Casting here is safe — both
  // plugins implement the BetterAuthPlugin interface at runtime.
  const plugins: BetterAuthPlugin[] = [apiKey() as BetterAuthPlugin];
  if (orgEnabled) {
    plugins.push(organization() as BetterAuthPlugin);
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
    // better-auth's getSession return type doesn't include additionalFields (role) in its
    // static types, but the value is present at runtime. Cast to AuthSession which includes role.
    getSession: (headers) => auth.api.getSession({ headers }) as Promise<AuthSession | null>,
    handler: (request) => auth.handler(request),
  };

  // The apiKey() plugin adds verifyApiKey to auth.api at runtime, but the dynamic plugin
  // composition means TypeScript can't statically infer the merged API type. Cast to a
  // minimal interface rather than using `any`. ApiKey.referenceId holds the userId.
  type VerifyApiKeyResult = { valid: boolean; key: ApiKey | null };
  type AuthApiWithVerifyApiKey = typeof auth.api & {
    verifyApiKey: (opts: { body: { key: string } }) => Promise<VerifyApiKeyResult>;
  };

  const verifyApiKey = async (key: string): Promise<{ userId: string } | null> => {
    try {
      const result = await (auth.api as AuthApiWithVerifyApiKey).verifyApiKey({ body: { key } });
      if (result && result.valid && result.key?.referenceId) {
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

export { authSchema } from './schema';
export { sessionMiddleware, optionalSessionMiddleware } from './middleware';
export { createAuthAuditHooks } from './audit-hooks';
