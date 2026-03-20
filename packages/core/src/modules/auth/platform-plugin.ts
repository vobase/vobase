import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { JWTPayload } from 'jose';
import { jwtVerify } from 'jose';
import * as z from 'zod';

import { logger } from '../../infra/logger';

export interface PlatformAuthConfig {
  hmacSecret: string;
}

export const platformAuth = (config: PlatformAuthConfig) => {
  const secretKey = new TextEncoder().encode(config.hmacSecret);

  return {
    id: 'platform-auth',
    endpoints: {
      platformCallback: createAuthEndpoint(
        '/platform-callback',
        {
          method: 'GET',
          query: z.object({
            token: z.string(),
            returnTo: z.string().optional(),
          }),
        },
        async (ctx) => {
          const { token, returnTo } = ctx.query;

          // 1. Verify handoff JWT
          // ctx.context.baseURL includes the /api/auth path (e.g., "https://example.com/api/auth")
          // but the platform signs JWTs with aud = tenant.instanceUrl (e.g., "https://example.com").
          // Accept both formats for robustness.
          const baseURL = ctx.context.baseURL;
          const instanceUrl = baseURL.replace(/\/api\/auth\/?$/, '');
          let payload: JWTPayload;
          try {
            const result = await jwtVerify(token, secretKey, {
              algorithms: ['HS256'],
              audience: [instanceUrl, baseURL],
            });
            payload = result.payload;
          } catch (err) {
            logger.warn('[platform] Invalid handoff JWT', {
              error: err instanceof Error ? err.message : String(err),
            });
            throw new APIError('BAD_REQUEST', {
              message: 'Invalid or expired token',
            });
          }

          const profile = payload.profile as {
            email: string;
            name: string;
            picture?: string;
            providerId: string;
          };
          const provider = payload.provider as string;

          if (!profile?.email || !profile?.name || !profile?.providerId || !provider) {
            throw new APIError('BAD_REQUEST', {
              message: 'Invalid token payload',
            });
          }

          try {
            // 2. Find or create user + link account
            const existing = await ctx.context.internalAdapter.findUserByEmail(
              profile.email,
              { includeAccounts: true },
            );
            let user: NonNullable<typeof existing>['user'];

            if (existing) {
              user = existing.user;
              // Link account if not already linked for this provider
              const hasAccount = existing.accounts.some(
                (a) =>
                  a.providerId === provider &&
                  a.accountId === profile.providerId,
              );
              if (!hasAccount) {
                await ctx.context.internalAdapter.createAccount({
                  userId: user.id,
                  providerId: provider,
                  accountId: profile.providerId,
                  // OAuth tokens intentionally not stored — the platform manages token lifecycle
                });
              }
            } else {
              const result = await ctx.context.internalAdapter.createOAuthUser(
                {
                  email: profile.email,
                  name: profile.name,
                  image: profile.picture ?? null,
                  emailVerified: true,
                },
                {
                  providerId: provider,
                  accountId: profile.providerId,
                  // OAuth tokens intentionally not stored — the platform manages token lifecycle
                },
              );
              user = result.user;
            }

            // 3. Create session + set signed cookie (better-auth handles HMAC signing natively)
            const session = await ctx.context.internalAdapter.createSession(
              user.id,
            );
            await setSessionCookie(ctx, { session, user });

            // 4. Redirect (validate returnTo is a relative path, not open redirect)
            const redirectTo =
              returnTo?.startsWith('/') && !returnTo.startsWith('//')
                ? returnTo
                : '/';
            throw ctx.redirect(redirectTo);
          } catch (err) {
            // Re-throw redirects — ctx.redirect() throws an object with status: "FOUND"
            const e = err as Record<string, unknown>;
            if (
              err instanceof Response ||
              e.status === 302 ||
              e.status === 'FOUND'
            )
              throw err;

            logger.error('[platform] Platform callback error', {
              error: err instanceof Error ? err.message : String(err),
              email: profile.email,
              provider,
            });
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Authentication failed',
            });
          }
        },
      ),
    },
  } satisfies BetterAuthPlugin;
};
