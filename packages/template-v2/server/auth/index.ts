import type { ScopedDb } from '@server/contracts/scoped-db'
import {
  authAccount,
  authInvitation,
  authMember,
  authOrganization,
  authSession,
  authUser,
  authVerification,
  logger,
} from '@vobase/core'
import { type BetterAuthPlugin, betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { organization } from 'better-auth/plugins/organization'
import { productName } from '../branding'
import { renderOtpEmail } from '../emails'
import { sendEmail } from '../emails/sender'
import { devAuth } from './dev-plugin'
import { platformAuth } from './platform-plugin'

const authTableMap = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  organization: authOrganization,
  member: authMember,
  invitation: authInvitation,
}

function parseAllowedEmailDomains(): string[] {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS ?? process.env.VITE_ALLOWED_EMAIL_DOMAINS ?? ''
  return raw
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d.length > 0)
}

export function createAuth(db: ScopedDb) {
  // Single-project default: orgs are opt-in for "multiple companies under one
  // install" setups (e.g. agency serving N clients). `allowUserToCreateOrganization`
  // stays false until a project explicitly flips VOBASE_MULTI_ORG=true — keeps
  // sign-up flow dead simple for the common single-org case.
  const multiOrg = process.env.VOBASE_MULTI_ORG === 'true'

  const plugins: BetterAuthPlugin[] = [
    emailOTP({
      sendVerificationOTP: async ({ email, otp, type }) => {
        try {
          const html = await renderOtpEmail({ otp, type })
          await sendEmail({
            to: email,
            subject: `[${productName}] Your sign-in verification code`,
            html,
          })
        } catch (err) {
          logger.error('[auth:otp] Failed to send verification email', {
            error: err instanceof Error ? err.message : String(err),
            email,
            type,
          })
          throw err
        }
      },
      otpLength: 6,
      expiresIn: 300,
    }),
    organization({
      allowUserToCreateOrganization: multiOrg,
      // Teams deferred — better-auth migration-order bug (github.com/better-auth/better-auth#6832)
      // plus we don't have a UI for them yet. Flip when both are addressed.
      teams: { enabled: false },
    }),
  ]

  const platformSecret = process.env.PLATFORM_HMAC_SECRET
  if (platformSecret) {
    plugins.push(
      platformAuth({
        hmacSecret: platformSecret,
        allowedEmailDomains: parseAllowedEmailDomains(),
      }),
    )
  }

  if (process.env.NODE_ENV !== 'production') plugins.push(devAuth())

  return betterAuth({
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-adapter accepts any drizzle instance
    database: drizzleAdapter(db as any, { provider: 'pg', schema: authTableMap }),
    emailAndPassword: { enabled: false },
    plugins,
    session: {
      // 5 minutes of signed-cookie cache — avoids a DB hit for `getSession` in
      // `requireSession` on every request. Invalidation is immediate on
      // sign-out/revoke because better-auth re-signs the cookie on those flows.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === 'production',
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
