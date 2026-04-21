/**
 * Inbound auth helpers for the web channel.
 *
 * Two paths into `POST /api/channel-web/inbound`:
 *
 * 1. Session-authed browser (widget + /chat page). Request carries a
 *    better-auth session via cookie or `Authorization: Bearer <token>` (the
 *    widget hands the token to its iframe to dodge 3rd-party-cookie blocks).
 *    `organizationId` + `from` identifier are derived from the session so a
 *    visitor can't forge them.
 *
 * 2. Server-to-server webhook (dev `test-web.tsx`, external bots). HMAC-signed
 *    payload; the handler verifies and trusts the `organizationId` + `from`
 *    fields it carries.
 */
import { ChannelInboundEventSchema } from '@server/contracts/channel-event'
import { z } from 'zod'
import { getAuth } from './state'

/** Body posted by browser clients — no organizationId/from (those come from the session). */
export const BrowserInboundBodySchema = z.object({
  content: z.string(),
  contentType: ChannelInboundEventSchema.shape.contentType,
  externalMessageId: z.string(),
  profileName: z.string().optional(),
})

export type BrowserInboundBody = z.infer<typeof BrowserInboundBodySchema>

export interface SessionLike {
  user: { id: string; name?: string | null }
  session: { activeOrganizationId: string | null }
}

/** Read the better-auth session. Returns null when auth isn't wired (tests) or no session is present. */
export async function getSessionFromRequest(headers: Headers): Promise<SessionLike | null> {
  const auth = getAuth()
  if (!auth) return null
  const session = (await auth.api.getSession({ headers })) as SessionLike | null
  return session
}
