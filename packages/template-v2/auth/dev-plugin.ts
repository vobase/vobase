import type { BetterAuthPlugin } from 'better-auth'
import { createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import * as z from 'zod'

const DEFAULT_DEV_ORG_ID = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

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
            const result = await ctx.context.internalAdapter.createOAuthUser(
              { email, name: name ?? email.split('@')[0], emailVerified: true },
              { providerId: 'dev', accountId: email },
            )
            user = result.user
          }

          // Ensure the user is a member of the default dev org so
          // `requireOrganization` has something to resolve.
          const adapter = ctx.context.adapter as unknown as {
            findOne: (args: { model: string; where: { field: string; value: unknown }[] }) => Promise<unknown>
            create: (args: { model: string; data: Record<string, unknown> }) => Promise<unknown>
          }
          const org = (await adapter.findOne({
            model: 'organization',
            where: [{ field: 'id', value: DEFAULT_DEV_ORG_ID }],
          })) as { id: string } | null
          if (org) {
            const existingMember = await adapter.findOne({
              model: 'member',
              where: [
                { field: 'userId', value: user.id },
                { field: 'organizationId', value: DEFAULT_DEV_ORG_ID },
              ],
            })
            if (!existingMember) {
              await adapter.create({
                model: 'member',
                data: {
                  userId: user.id,
                  organizationId: DEFAULT_DEV_ORG_ID,
                  role: 'member',
                  createdAt: new Date(),
                },
              })
            }
          }

          const session = await ctx.context.internalAdapter.createSession(user.id)
          await setSessionCookie(ctx, { session, user })

          return ctx.json({ user: { id: user.id, email: user.email, name: user.name } })
        },
      ),
    },
  } satisfies BetterAuthPlugin
}
