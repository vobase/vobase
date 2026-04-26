import type { BetterAuthPlugin } from 'better-auth'
import { createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import * as z from 'zod'

export function devAuth(): BetterAuthPlugin {
  return {
    id: 'dev-auth',
    endpoints: {
      devLogin: createAuthEndpoint(
        '/dev-login',
        {
          method: 'POST',
          body: z.object({
            email: z.string().email(),
            name: z.string().optional(),
          }),
        },
        async (ctx) => {
          const { email, name } = ctx.body

          const existing = await ctx.context.internalAdapter.findUserByEmail(email, { includeAccounts: true })

          let user: NonNullable<typeof existing>['user']
          if (existing) {
            user = existing.user
          } else {
            // user.create.after hook auto-enrolls into the sole org (single-org
            // mode) or accepts a pending invite.
            const result = await ctx.context.internalAdapter.createOAuthUser(
              { email, name: name ?? email.split('@')[0], emailVerified: true },
              { providerId: 'dev', accountId: email },
            )
            user = result.user
          }

          // session.create.before hook in auth/index.ts:
          //   - calls autoEnroll for pre-existing users (covers users who
          //     signed up before the auto-enroll hook existed)
          //   - sets activeOrganizationId on the session from the user's
          //     first membership
          const session = await ctx.context.internalAdapter.createSession(user.id)
          await setSessionCookie(ctx, { session, user })

          return ctx.json({ user: { id: user.id, email: user.email, name: user.name } })
        },
      ),
    },
  } satisfies BetterAuthPlugin
}
