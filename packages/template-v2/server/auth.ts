import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins/email-otp'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import {
  authAccount,
  authSession,
  authUser,
  authVerification,
} from '@vobase/core'

const authTableMap = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
}

export function createAuth(db: PostgresJsDatabase) {
  return betterAuth({
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-adapter accepts any drizzle instance
    database: drizzleAdapter(db as any, { provider: 'pg', schema: authTableMap }),
    emailAndPassword: { enabled: false },
    plugins: [
      emailOTP({
        sendVerificationOTP: async ({ email, otp, type }) => {
          // Dev: logs OTP to console. Wire a real email adapter here in production.
          console.log(`[auth:otp] email=${email} type=${type} otp=${otp}`)
        },
        otpLength: 6,
        expiresIn: 300,
      }),
    ],
    advanced: {
      useSecureCookies: process.env.NODE_ENV === 'production',
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
