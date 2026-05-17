import { ac, roles } from '@auth/ac'
import {
  anonymousClient,
  emailOTPClient,
  magicLinkClient,
  organizationClient,
  phoneNumberClient,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  plugins: [
    anonymousClient(),
    emailOTPClient(),
    phoneNumberClient(),
    magicLinkClient(),
    organizationClient({
      teams: { enabled: true },
      ac,
      roles,
    }),
  ],
})
