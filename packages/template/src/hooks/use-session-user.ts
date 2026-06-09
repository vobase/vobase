import { authClient } from '@/lib/auth-client'

/**
 * Signed-in user inferred from the configured better-auth client. Because
 * `auth-client.ts` registers `phoneNumberClient()`, the inferred shape carries
 * `phoneNumber` and `phoneNumberVerified` — so readers get them type-safely
 * with no cast.
 */
export type SessionUser = typeof authClient.$Infer.Session.user

/** Typed reader for the signed-in user, or null when there is no session. */
export function useSessionUser(): SessionUser | null {
  const { data } = authClient.useSession()
  return data?.user ?? null
}
