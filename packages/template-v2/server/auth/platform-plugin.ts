/**
 * Platform SSO callback plugin.
 *
 * The platform handles OAuth (Google, Microsoft, etc.) and issues a signed JWT
 * containing the user profile. It redirects to `/api/auth/platform-callback?token=...`.
 * This plugin verifies the JWT, finds-or-creates the user, links the OAuth
 * account, sets a session cookie, and redirects to the app.
 *
 * Registered alongside `devAuth()` + `emailOTP()` in `createAuth()` when
 * `PLATFORM_HMAC_SECRET` is set.
 */

import { logger } from '@vobase/core'
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { type JWTPayload, jwtVerify } from 'jose'
import * as z from 'zod'

export interface PlatformAuthConfig {
  hmacSecret: string
  /** Restrict platform sign-in to specific email domains. */
  allowedEmailDomains?: string[]
  /**
   * Optional lookup used to bypass the domain allowlist when an admin has
   * invited a user with an out-of-allowlist email. Returns `true` if there's
   * a pending `authInvitation` for the given email.
   */
  hasPendingInvitation?: (email: string) => Promise<boolean>
}

interface PlatformProfile {
  email: string
  name: string
  picture?: string
  providerId: string
}

export function platformAuth(config: PlatformAuthConfig): BetterAuthPlugin {
  const secretKey = new TextEncoder().encode(config.hmacSecret)

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
          const { token, returnTo } = ctx.query

          // 1. Verify handoff JWT.
          // ctx.context.baseURL includes the /api/auth path (e.g., "https://example.com/api/auth")
          // but the platform signs JWTs with aud = organization.instanceUrl (e.g., "https://example.com").
          // Accept both formats for robustness.
          const baseURL = ctx.context.baseURL
          const instanceUrl = baseURL.replace(/\/api\/auth\/?$/, '')
          let payload: JWTPayload
          try {
            const result = await jwtVerify(token, secretKey, {
              algorithms: ['HS256'],
              audience: [instanceUrl, baseURL],
            })
            payload = result.payload
          } catch (err) {
            logger.warn({ error: err instanceof Error ? err.message : String(err) }, '[platform] Invalid handoff JWT')
            throw new APIError('BAD_REQUEST', { message: 'Invalid or expired token' })
          }

          const profile = payload.profile as PlatformProfile | undefined
          const provider = typeof payload.provider === 'string' ? payload.provider : undefined

          if (!profile?.email || !profile?.name || !profile?.providerId || !provider) {
            throw new APIError('BAD_REQUEST', { message: 'Invalid token payload' })
          }

          try {
            // 2. Find or create user + link account.
            const existing = await ctx.context.internalAdapter.findUserByEmail(profile.email, {
              includeAccounts: true,
            })
            let user: NonNullable<typeof existing>['user']

            // Domain allowlist only applies to net-new users without a pending
            // invitation. Existing users and invitees bypass it so admins can
            // onboard external collaborators without relaxing the global gate.
            if (!existing && config.allowedEmailDomains?.length) {
              const allowed = new Set(config.allowedEmailDomains.map((d) => d.toLowerCase()))
              const domain = profile.email.split('@')[1]?.toLowerCase()
              if (!domain || !allowed.has(domain)) {
                let invited = false
                if (config.hasPendingInvitation) {
                  try {
                    invited = await config.hasPendingInvitation(profile.email)
                  } catch (err) {
                    logger.warn(
                      { error: err instanceof Error ? err.message : String(err), email: profile.email },
                      '[platform] invitation lookup failed; falling back to domain gate',
                    )
                  }
                }
                if (!invited) {
                  logger.warn(
                    { email: profile.email, domain, allowed: [...allowed] },
                    '[platform] Domain not in allowlist',
                  )
                  throw new APIError('FORBIDDEN', {
                    message: `Sign-up is restricted to approved email domains. "${domain ?? profile.email}" is not allowed. Contact your administrator to request access.`,
                  })
                }
              }
            }

            if (existing) {
              user = existing.user
              const hasAccount = existing.accounts.some(
                (a) => a.providerId === provider && a.accountId === profile.providerId,
              )
              if (!hasAccount) {
                await ctx.context.internalAdapter.createAccount({
                  userId: user.id,
                  providerId: provider,
                  accountId: profile.providerId,
                  // OAuth tokens intentionally not stored — platform manages lifecycle.
                })
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
                  // OAuth tokens intentionally not stored — platform manages lifecycle.
                },
              )
              if (!result) throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Failed to create user' })
              user = result.user
            }

            // 3. Create session + set signed cookie (better-auth HMAC-signs natively).
            const session = await ctx.context.internalAdapter.createSession(user.id)
            await setSessionCookie(ctx, { session, user })

            // 4. Redirect (validate returnTo is a safe relative path — open-redirect guard).
            // Reject: protocol-relative (//), backslash-relative (\), anything containing ://
            // (schema injection), and /api/auth/* to avoid redirect loops through this plugin.
            const isSafeReturnTo =
              typeof returnTo === 'string' &&
              returnTo.startsWith('/') &&
              !returnTo.startsWith('//') &&
              !returnTo.startsWith('/\\') &&
              !returnTo.includes('://') &&
              !returnTo.includes('\\') &&
              !returnTo.startsWith('/api/auth/')
            const redirectTo = isSafeReturnTo ? returnTo : '/'
            throw ctx.redirect(redirectTo)
          } catch (err) {
            // Re-throw redirects — ctx.redirect() throws an object with status: "FOUND".
            const e = err as Record<string, unknown>
            if (err instanceof Response || e.status === 302 || e.status === 'FOUND') throw err

            // Re-throw known API errors (e.g. domain allowlist FORBIDDEN).
            if (err instanceof APIError) throw err

            logger.error(
              {
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
                email: profile.email,
                provider,
              },
              '[platform] Platform callback error',
            )
            throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Authentication failed' })
          }
        },
      ),
    },
  } satisfies BetterAuthPlugin
}
