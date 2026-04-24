/**
 * POST /api/channel-web/anonymous-session
 *
 * Mints an anonymous better-auth session and returns the bearer token. The
 * public /chat page uses this instead of the cookie flow so the widget's
 * anonymous session stays isolated from the dashboard cookie on the same
 * origin. Response never sets a cookie — `Set-Cookie` is stripped.
 */
import type { Context } from 'hono'

import { getAuth } from '../service/state'

// Plugin methods aren't reflected on the erased `BetterAuthPlugin[]` type the
// root auth instance carries, so we shape the single endpoint we call here.
type AnonymousApi = {
  signInAnonymous(args: { headers: Headers; returnHeaders: true }): Promise<{
    headers: Headers
    response: { token: string; user: { id: string } } | null
  }>
}

export async function handleAnonymousSession(c: Context): Promise<Response> {
  const auth = getAuth()
  if (!auth) return c.json({ error: 'auth_unavailable' }, 503)

  const api = auth.api as unknown as AnonymousApi
  const res = await api.signInAnonymous({
    headers: c.req.raw.headers,
    returnHeaders: true,
  })
  const payload = res.response
  if (!payload?.token) return c.json({ error: 'anonymous_signin_failed' }, 500)

  return c.json({ token: payload.token, userId: payload.user.id })
}
