import type { ApiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import type {
  AuthAdapter,
  AuthSession,
  CreateApiKey,
  RevokeApiKey,
  VerifyApiKey,
} from '../../contracts/auth';
import { logger } from '../../infra/logger';
import {
  authInvitation,
  authMember,
  authOrganization,
  authSession,
  authUser,
} from './schema';
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

/**
 * After sign-in, auto-add user to an organization and set it active on the session.
 *
 * 1. Pending invitation for this email → accept it (any mode)
 * 2. Domain matches allowedEmailDomains → join the sole org (single-org mode only)
 *
 * Returns the joined org ID so the caller can set activeOrganizationId.
 * @internal Exported for testing only.
 */
export async function autoJoinOrganization(
  db: VobaseDb,
  userId: string,
  email: string,
  config?: AuthModuleConfig,
): Promise<string | null> {
  // Skip if user already belongs to an org
  const [existingMembership] = await db
    .select({ id: authMember.id, organizationId: authMember.organizationId })
    .from(authMember)
    .where(eq(authMember.userId, userId))
    .limit(1);
  if (existingMembership) return existingMembership.organizationId;

  // 1. Check for pending invitations (works in both single-org and multi-org)
  const [pendingInvitation] = await db
    .select({
      id: authInvitation.id,
      organizationId: authInvitation.organizationId,
      role: authInvitation.role,
    })
    .from(authInvitation)
    .where(
      and(
        eq(authInvitation.email, email),
        eq(authInvitation.status, 'pending'),
      ),
    )
    .limit(1);

  if (pendingInvitation) {
    await db.transaction(async (tx) => {
      await tx.insert(authMember).values({
        id: crypto.randomUUID(),
        userId,
        organizationId: pendingInvitation.organizationId,
        role: pendingInvitation.role,
      });
      await tx
        .update(authInvitation)
        .set({ status: 'accepted' })
        .where(eq(authInvitation.id, pendingInvitation.id));
    });
    logger.info(`[auth] Auto-accepted invitation for ${email}`);
    return pendingInvitation.organizationId;
  }

  // 2. Domain-based auto-join — single-org mode only
  //    In multi-org, users must be explicitly invited to specific orgs.
  if (!config?.multiOrg && config?.allowedEmailDomains?.length) {
    const domain = email.split('@')[1]?.toLowerCase();
    const allowed = new Set(
      config.allowedEmailDomains.map((d) => d.toLowerCase()),
    );
    if (domain && allowed.has(domain)) {
      const [soleOrg] = await db
        .select({ id: authOrganization.id })
        .from(authOrganization)
        .limit(1);
      if (soleOrg) {
        await db.insert(authMember).values({
          id: crypto.randomUUID(),
          userId,
          organizationId: soleOrg.id,
          role: 'member',
        });
        logger.info(`[auth] Auto-joined ${email} to org via domain match`);
        return soleOrg.id;
      }
    }
  }

  return null;
}

function buildAuthHooks(db: VobaseDb, config?: AuthModuleConfig) {
  const auditHooks = createAuthAuditHooks(db);
  const domains = config?.allowedEmailDomains;
  const allowed = domains?.length
    ? new Set(domains.map((d) => d.toLowerCase()))
    : null;

  return {
    before: createAuthMiddleware(async (ctx) => {
      if (
        allowed &&
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
    after: createAuthMiddleware(async (ctx) => {
      // Run audit after hook first
      await auditHooks.after(ctx);

      // Auto-join org after any sign-in that creates a new session
      const session = ctx.context.newSession;
      if (session) {
        const user = session.user;
        if (user?.id && user?.email) {
          try {
            const orgId = await autoJoinOrganization(
              db,
              user.id,
              user.email,
              config,
            );
            // Auto-set active org on the session so requireOrg() works immediately
            if (orgId && session?.session?.id && !session.session.activeOrganizationId) {
              await db
                .update(authSession)
                .set({ activeOrganizationId: orgId })
                .where(eq(authSession.id, session.session.id));
            }
          } catch (err) {
            logger.error('[auth] Auto-join org failed:', err);
          }
        }
      }
    }),
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
export type {
  AuthModuleConfig,
  SendInvitationEmail,
  SendVerificationOTP,
} from './config';
export { optionalSessionMiddleware, sessionMiddleware } from './middleware';
export { authTableMap } from './schema';
