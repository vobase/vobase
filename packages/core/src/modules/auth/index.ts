import crypto from 'node:crypto';
import type { ApiKey } from '@better-auth/api-key';
import { apiKey } from '@better-auth/api-key';
import type { BetterAuthPlugin, SocialProviders } from 'better-auth';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import type { AuthAdapter, AuthSession } from '../../contracts/auth';
import type { VobaseDb } from '../../db/client';
import type { VobaseModule } from '../../module';
import { defineBuiltinModule } from '../../module';
import { createAuthAuditHooks } from './audit-hooks';
import { setOrganizationEnabled } from './permissions';
import {
  apikeySchema,
  authSchema,
  authSession,
  authUser,
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

  // Extend the auth.api type to include admin methods added by plugins at runtime
  type AuthApiExtended = typeof auth.api & {
    createUser: (opts: {
      body: { email: string; name: string; password: string; role?: string };
    }) => Promise<{ user: { id: string } } | null>;
    listUsers?: (opts: {
      query: { searchValue: string; searchField: string; limit: number };
    }) => Promise<{ users: { id: string; email: string }[] }>;
  };

  const adapter: AuthAdapter = {
    // better-auth's getSession return type doesn't include additionalFields (role) in its
    // static types, but the value is present at runtime. Cast to AuthSession which includes role.
    getSession: (headers) =>
      auth.api.getSession({ headers }) as Promise<AuthSession | null>,
    handler: (request) => auth.handler(request),

    async createPlatformSession(profile) {
      const api = auth.api as AuthApiExtended;

      // Find existing user by email via DB query
      const existingRows = await db
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.email, profile.email))
        .limit(1);

      let userId: string;

      if (existingRows.length > 0) {
        userId = existingRows[0].id;
      } else {
        // Create new user — use a strong random password (user authenticates via platform, never via password)
        const randomPassword = `platform-${crypto.randomUUID()}-${crypto.randomUUID()}`;
        try {
          const result = await auth.api.signUpEmail({
            body: {
              email: profile.email,
              name: profile.name,
              password: randomPassword,
            },
          });
          if (!result?.user?.id) {
            console.error('[platform] signUpEmail returned no user');
            return null;
          }
          userId = result.user.id;
        } catch (err) {
          console.error('[platform] Failed to create user:', err);
          return null;
        }
      }

      // Create session directly via DB — better-auth's internalAdapter.createSession
      // is not accessible outside plugins, so we create the session record directly.
      const sessionToken = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await db.insert(authSession).values({
        id: sessionId,
        userId,
        token: sessionToken,
        expiresAt,
        ipAddress: null,
        userAgent: null,
      });

      return { token: sessionToken, sessionId, userId };
    },
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
