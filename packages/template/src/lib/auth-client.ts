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

/**
 * Force the reactive `useSession()` store to reflect a just-committed change to
 * the signed-in user (e.g. a phone-number verify).
 *
 * The server runs a 5-minute session cookie cache (`session.cookieCache` in
 * `auth/index.ts`), so the automatic post-verify session refetch returns stale
 * user data. `disableCookieCache` makes the server re-read the DB and rewrite
 * the cache; the signal toggle then re-runs the session atom against it.
 */
export async function refreshSession(): Promise<void> {
  await authClient.getSession({ query: { disableCookieCache: true } })
  authClient.$store.notify('$sessionSignal')
}
