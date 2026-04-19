import { authAccount, authSession, authUser, authVerification } from '@vobase/core'
import { type BetterAuthPlugin, betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins/email-otp'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { devAuth } from './dev-auth-plugin'

const authTableMap = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
}

export function createAuth(db: PostgresJsDatabase) {
  const plugins: BetterAuthPlugin[] = [
    emailOTP({
      sendVerificationOTP: async ({ email, otp, type }) => {
        // Dev: logs OTP to console. Wire a real email adapter here in production.
        console.log(`[auth:otp] email=${email} type=${type} otp=${otp}`)
      },
      otpLength: 6,
      expiresIn: 300,
    }),
  ]
  if (process.env.NODE_ENV !== 'production') plugins.push(devAuth())

  return betterAuth({
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-adapter accepts any drizzle instance
    database: drizzleAdapter(db as any, { provider: 'pg', schema: authTableMap }),
    emailAndPassword: { enabled: false },
    plugins,
    advanced: {
      useSecureCookies: process.env.NODE_ENV === 'production',
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
