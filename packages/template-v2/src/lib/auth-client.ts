import { anonymousClient, emailOTPClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

import { ac, roles } from '../../server/auth/ac'

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
