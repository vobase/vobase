/**
 * US-019 — Invite-acceptance redirect middleware.
 *
 * Wraps `POST /api/auth/organization/accept-invitation` so a newly-accepted
 * staff invite is steered into the phone-verification onboarding flow before
 * the SPA lands on /inbox.
 *
 * ## Why a middleware (not the better-auth `afterAcceptInvitation` hook)
 *
 * better-auth's `organization` plugin exposes an `organizationHooks.afterAcceptInvitation`
 * callback (see node_modules/better-auth/dist/plugins/organization/types.d.mts §534).
 * The hook fires AFTER the new `member` row is committed but BEFORE the
 * endpoint returns `ctx.json({ invitation, member })`. It receives the user
 * object but can only return `Promise<void>` — it cannot rewrite the response
 * into a 302, throw a structured redirect, or attach a `Location` header.
 *
 * To shape the response we'd need either (a) better-auth's `customSession` /
 * generic-endpoint plugin scaffolding (no equivalent exists for accept) or
 * (b) a Hono-level interceptor that inspects the post-handler response. (b)
 * is the documented escape hatch — we mount this middleware in
 * `runtime/bootstrap.ts` BEFORE the `/api/auth/*` catch-all so it can:
 *   1. Forward the request to better-auth's handler unchanged.
 *   2. Inspect the JSON response. If 200, look up `phoneNumberVerified`.
 *   3. If unverified → rewrite to 302 → `/onboard/verify-phone?next=<callbackURL ?? /inbox>`.
 *   4. Otherwise pass the original response through.
 *
 * The XHR caller (`authClient.organization.acceptInvitation`) will see the
 * 302; the SPA wrapper in `src/lib/auth-client.ts` invokes better-auth-react,
 * which follows redirects by surfacing the `Location` to the caller via
 * `fetchOptions.onSuccess` (the SPA route at /onboard/verify-phone is
 * implemented in US-020). The integration tests use `app.fetch(...)` with
 * `redirect: 'manual'` so they directly observe the 302 + Location header.
 *
 * ## AC #8 — email invariant
 *
 * better-auth's schema enforces `auth.user.email NOT NULL` at the column
 * level (see `schema-tables.ts:11`), but we re-assert here at the redirect
 * boundary so a corrupted row (manual SQL surgery, replication lag) surfaces
 * as an explicit `VobaseError` rather than a downstream `null.includes` crash
 * in the onboarding page.
 */

import { logger, VobaseError } from '@vobase/core'
import { eq } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'

import type { ScopedDb } from '~/runtime'
import { authUser } from './schema'

/** The onboarding route the unverified user is redirected to. Owned by US-020. */
const VERIFY_PHONE_PATH = '/onboard/verify-phone'
/** Fallback `next` query target when the original accept-invitation request omits one. */
const DEFAULT_NEXT_PATH = '/inbox'
/** better-auth's accept endpoint (mounted under the global `/api/auth` basePath). */
const ACCEPT_PATH_SUFFIX = '/api/auth/organization/accept-invitation'

interface AcceptResponseBody {
  invitation?: { id?: unknown }
  member?: { userId?: unknown }
}

interface AcceptRequestBody {
  invitationId?: unknown
  callbackURL?: unknown
}

/**
 * Hono middleware mounted on POST `${basePath}/organization/accept-invitation`.
 *
 * Forwards to the next handler (better-auth) and, if the response is a 200
 * indicating a successful accept, looks up the joined user's
 * `phoneNumberVerified` flag. Unverified ⇒ rewrite to 302 redirect; verified
 * ⇒ pass through.
 *
 * Errors during the lookup or invariant check propagate as `VobaseError` (AC#8).
 * Any unexpected failure logs + returns the original response — the staff is
 * already enrolled in the org, so swallowing here keeps the dashboard usable.
 */
export function createInviteAcceptRedirectMiddleware(db: ScopedDb): MiddlewareHandler {
  return async (c: Context, next) => {
    // Only intercept the exact accept endpoint — other org routes pass through.
    // Methods other than POST aren't valid for accept, but better-auth will 405
    // them; let it handle non-POSTs untouched.
    const url = new URL(c.req.url)
    if (c.req.method !== 'POST' || !url.pathname.endsWith(ACCEPT_PATH_SUFFIX)) {
      await next()
      return
    }

    // Read the request body BEFORE forwarding — Hono's c.req.json() drains the
    // stream, so clone via raw fetch into a buffered Request. We need
    // `callbackURL` for the redirect `next` query param.
    let originalBody: AcceptRequestBody = {}
    let rawBodyText = ''
    try {
      rawBodyText = await c.req.raw.clone().text()
      originalBody = rawBodyText ? (JSON.parse(rawBodyText) as AcceptRequestBody) : {}
    } catch {
      // Malformed JSON — let better-auth handle the 400.
      originalBody = {}
    }

    // Forward to better-auth handler.
    await next()
    const res = c.res
    if (res.status !== 200) return // Failure: pass through.

    // Buffer + reparse the JSON response so we can read userId from `member`.
    let payload: AcceptResponseBody
    try {
      const cloned = res.clone()
      payload = (await cloned.json()) as AcceptResponseBody
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[auth:invite-redirect] response not json')
      return
    }

    const userId = typeof payload.member?.userId === 'string' ? payload.member.userId : null
    if (!userId) return // Defensive: no member shape, nothing to gate on.

    // Look up the joined user: phoneNumberVerified + email invariant (AC#8).
    // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
    const dbAny = db as any
    let row: { email: string | null; phoneNumberVerified: boolean | null } | undefined
    try {
      const rows = await dbAny
        .select({ email: authUser.email, phoneNumberVerified: authUser.phoneNumberVerified })
        .from(authUser)
        .where(eq(authUser.id, userId))
        .limit(1)
      row = rows[0] as typeof row
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), userId },
        '[auth:invite-redirect] user lookup failed',
      )
      return
    }
    if (!row) return // User row vanished between accept and lookup — let SPA recover.

    // AC #8: `authUser.email !== null` invariant. better-auth's schema marks
    // email NOT NULL, so this only trips on schema drift / direct SQL surgery.
    if (row.email === null) {
      throw new VobaseError('auth.user.email invariant violated after invite acceptance', 'INTERNAL', 500, {
        userId,
        reason: 'INVITE_ACCEPT_USER_EMAIL_NULL',
      })
    }

    // If already phone-verified, no redirect — staff lands directly on /inbox.
    if (row.phoneNumberVerified === true) return

    // Build the redirect URL. `next` defaults to /inbox; if the SPA passed
    // a `callbackURL` to acceptInvitation we honor it (subject to a same-origin
    // sanity check — the path must start with `/`).
    const callbackURL = typeof originalBody.callbackURL === 'string' ? originalBody.callbackURL : null
    const nextPath = callbackURL?.startsWith('/') ? callbackURL : DEFAULT_NEXT_PATH
    const location = `${VERIFY_PHONE_PATH}?next=${encodeURIComponent(nextPath)}`

    // Replace the response. Preserve any Set-Cookie headers better-auth set
    // (activeOrganizationId + session token rotation) so the next request from
    // the SPA is already scoped to the new org.
    const newHeaders = new Headers(res.headers)
    newHeaders.set('Location', location)
    newHeaders.delete('Content-Length')
    newHeaders.set('Content-Type', 'application/json; charset=utf-8')
    c.res = new Response(JSON.stringify({ redirect: location }), {
      status: 302,
      headers: newHeaders,
    })
  }
}
