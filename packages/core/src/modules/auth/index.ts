import type { ApiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import type {
  AuthAdapter,
  AuthSession,
  CreateApiKey,
  RevokeApiKey,
  VerifyApiKey,
} from '../../contracts/auth';
import { logger } from '../../infra/logger';
import { authUser } from './schema';
import type { VobaseDb } from '../../db/client';
import type { VobaseModule } from '../../module';
import { defineBuiltinModule } from '../../module';
import { createAuthAuditHooks } from './audit-hooks';
import {
  type AuthModuleConfig,
  authUserFields,
  getAuthPlugins,
} from './config';
import {
  apikeyTableMap,
  authApikey,
  authTableMap,
  organizationTableMap,
} from './schema';

export type AuthModule = VobaseModule & {
  adapter: AuthAdapter;
  verifyApiKey: VerifyApiKey;
  createApiKey: CreateApiKey;
  revokeApiKey: RevokeApiKey;
};

const SIGNUP_PATHS = [
  '/sign-up/email',
  '/sign-in/email-otp',
  '/email-otp/send-verification-otp',
];

function buildAuthHooks(db: VobaseDb, config?: AuthModuleConfig) {
  const auditHooks = createAuthAuditHooks(db);
  const domains = config?.allowedEmailDomains;
  if (!domains?.length) return auditHooks;

  const allowed = new Set(domains.map((d) => d.toLowerCase()));
  return {
    before: createAuthMiddleware(async (ctx) => {
      if (
        SIGNUP_PATHS.some((p) => ctx.path.startsWith(p)) &&
        ctx.body?.email
      ) {
        const domain = ctx.body.email.split('@')[1]?.toLowerCase();
        if (!domain || !allowed.has(domain)) {
          // Allow existing users (e.g. admin-invited) to sign in regardless of domain
          const [existing] = await db
            .select({ id: authUser.id })
            .from(authUser)
            .where(eq(authUser.email, ctx.body.email))
            .limit(1);
          if (!existing) {
            throw new APIError('FORBIDDEN', {
              message: 'Sign-up is restricted to approved email domains',
            });
          }
        }
      }
      // Run audit before hook
      return auditHooks.before(ctx);
    }),
    after: auditHooks.after,
  };
}

export function createAuthModule(
  db: VobaseDb,
  config?: AuthModuleConfig,
): AuthModule {
  const baseURL = config?.baseURL ?? process.env.BETTER_AUTH_URL;

  // All plugins installed statically — single source of truth in config.ts
  const adapterSchema = {
    ...authTableMap,
    ...apikeyTableMap,
    ...organizationTableMap,
  };

  const auth = betterAuth({
    appName: config?.appName ?? 'Vobase',
    database: drizzleAdapter(db, { provider: 'pg', schema: adapterSchema }),
    ...(baseURL && { baseURL }),
    emailAndPassword: { enabled: false },
    ...(config?.socialProviders && { socialProviders: config.socialProviders }),
    user: {
      additionalFields: authUserFields,
    },
    plugins: getAuthPlugins(config),
    hooks: buildAuthHooks(db, config),
    ...(config?.trustedOrigins && { trustedOrigins: config.trustedOrigins }),
    advanced: {
      // Only use Secure cookies in production. In dev, the server runs on
      // http://localhost and Secure cookies are rejected by the browser.
      useSecureCookies: process.env.NODE_ENV === 'production',
    },
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

  type AuthApiWithCreateApiKey = typeof auth.api & {
    createApiKey: (opts: {
      body: { name?: string; expiresIn?: number };
      headers: Headers | Record<string, string>;
    }) => Promise<ApiKey | null>;
  };

  const createApiKey = async (opts: {
    headers: Headers | Record<string, string>;
    name?: string;
    expiresIn?: number;
  }): Promise<{ key: string; id: string } | null> => {
    try {
      const result = await (auth.api as AuthApiWithCreateApiKey).createApiKey({
        body: {
          name: opts.name ?? 'automation',
          expiresIn: opts.expiresIn,
        },
        headers: opts.headers,
      });
      if (result?.key && result?.id) {
        return { key: result.key, id: result.id };
      }
      logger.error('[auth] createApiKey returned unexpected result:', result);
      return null;
    } catch (err) {
      logger.error('[auth] createApiKey failed:', err);
      return null;
    }
  };

  const revokeApiKey = async (keyId: string): Promise<boolean> => {
    try {
      const [updated] = await db
        .update(authApikey)
        .set({ enabled: false })
        .where(eq(authApikey.id, keyId))
        .returning({ id: authApikey.id });
      return !!updated;
    } catch (err) {
      logger.error('[auth] revokeApiKey failed:', err);
      return false;
    }
  };

  return {
    ...mod,
    adapter,
    verifyApiKey,
    createApiKey,
    revokeApiKey,
  };
}

export { createAuthAuditHooks } from './audit-hooks';
export type { AuthModuleConfig, SendVerificationOTP } from './config';
export { optionalSessionMiddleware, sessionMiddleware } from './middleware';
export { authTableMap } from './schema';
