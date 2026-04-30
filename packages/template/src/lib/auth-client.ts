import { ac, roles } from '@auth/ac'
import { anonymousClient, emailOTPClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  plugins: [
    anonymousClient(),
    emailOTPClient(),
    organizationClient({
      teams: { enabled: true },
      ac,
      roles,
    }),
  ],
})
