/**
 * Tenant-side magic-link finish route.
 *
 * Mounted at /auth/magic-finish (browser-facing, not under /api/). The platform 302s here
 * with the better-auth token; this handler verifies it, creates a session, sets
 * activeOrganizationId, issues Set-Cookie on the tenant's own host, and 302s to the SPA.
 */
import { logger } from '@vobase/core'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod/v4'

import type { ScopedDb } from '~/runtime'
import type { Auth } from './index'
import { authMember } from './schema'

const SAFE_REDIRECT_RE = /^\/[a-zA-Z0-9/_-]*$/
const SESSION_COOKIE_NAME = 'better-auth.session_token'

// ─── Error page ──────────────────────────────────────────────────────────────

function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Sign-in link expired</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
  .card { background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.1); padding: 2rem 2.5rem; max-width: 380px; text-align: center; }
  h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 .5rem; color: #111; }
  p { color: #6b7280; font-size: .9375rem; margin: 0 0 1.25rem; }
  a { display: inline-block; padding: .5rem 1.25rem; background: #2563eb; color: #fff; border-radius: 6px; text-decoration: none; font-size: .9375rem; }
</style>
</head>
<body>
<div class="card">
  <h1>Sign-in link expired</h1>
  <p>${message}</p>
  <a href="/auth/login">Request a fresh link</a>
</div>
</body>
</html>`
}

// ─── Token hashing ────────────────────────────────────────────────────────────

/** SHA-256 → base64url (no padding) — matches better-auth's `storeToken: 'hashed'` hasher. */
async function hashToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Buffer.from(hash).toString('base64url').replace(/=/g, '')
}

/**
 * Reproduce better-call's `signCookieValue` (the signer behind better-auth's
 * `setSignedCookie`): `encodeURIComponent(token + '.' + base64(HMAC-SHA256))`.
 *
 * better-auth writes the session-token cookie SIGNED and rejects an unsigned
 * value on read — so this route must sign the cookie itself, exactly as
 * `cookies/index.mjs::setSessionCookie` would, or the SPA loads unauthenticated.
 */
async function signSessionToken(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
  return encodeURIComponent(`${token}.${sigB64}`)
}

// ─── Query schema ─────────────────────────────────────────────────────────────

const finishQuerySchema = z.object({
  token: z.string().min(1),
  redirect: z.string().min(1),
  organization: z.string().min(1),
})

// ─── Route factory ────────────────────────────────────────────────────────────

export function createMagicFinishRoutes(auth: Auth, db: ScopedDb): Hono {
  return (
    new Hono()
      // Main finish handler — verify token, create session, set cookie, 302.
      .get('/', async (c) => {
        const parsed = finishQuerySchema.safeParse({
          token: c.req.query('token'),
          redirect: c.req.query('redirect'),
          organization: c.req.query('organization'),
        })

        if (!parsed.success) {
          logger.warn({ issues: parsed.error.issues }, '[magic-finish] missing required query params')
          return c.html(renderErrorPage('This link is invalid or missing required parameters.'), 400)
        }

        const { token, redirect, organization: organizationId } = parsed.data

        // Open-redirect guard — only relative paths with safe characters.
        const safeRedirect = SAFE_REDIRECT_RE.test(redirect) ? redirect : '/'

        let hashed: string
        try {
          hashed = await hashToken(token)
        } catch (err) {
          logger.warn(
            { error: err instanceof Error ? err.message : String(err) },
            '[magic-finish] token hashing failed',
          )
          return c.html(renderErrorPage('This link is invalid. Please request a fresh one.'), 400)
        }

        const authContext = await auth.$context
        const internalAdapter = authContext.internalAdapter

        // We don't call `auth.api.magicLinkVerify`: it owns the redirect via better-auth's
        // `originCheck` + `errorCallbackURL`, sets its own cookie, and has no
        // org-membership gate or `activeOrganizationId` write. We do reuse its core helper
        // — `consumeVerificationValue` atomically reads+deletes, giving us single-use
        // semantics without the race between find + manual attempt-bump.
        const tokenValue = await internalAdapter.consumeVerificationValue(hashed)
        if (!tokenValue) {
          logger.warn({ organizationId }, '[magic-finish] token not found or already consumed')
          return c.html(
            renderErrorPage('This link has already been used or has expired. Please request a fresh one.'),
            400,
          )
        }

        if (tokenValue.expiresAt < new Date()) {
          logger.warn({ organizationId }, '[magic-finish] token expired')
          return c.html(renderErrorPage('This link has expired. Please request a fresh one.'), 400)
        }

        let email: string
        try {
          email = (JSON.parse(tokenValue.value) as { email: string }).email
          if (!email) throw new Error('email missing from token payload')
        } catch {
          logger.warn({ organizationId }, '[magic-finish] could not parse token value')
          return c.html(renderErrorPage('This link is invalid. Please request a fresh one.'), 400)
        }

        const existing = await internalAdapter.findUserByEmail(email)
        const user = existing?.user
        if (!user) {
          logger.warn({ email, organizationId }, '[magic-finish] user not found for email')
          return c.html(renderErrorPage('No account found for this link. Please contact your administrator.'), 400)
        }

        // Validate organization membership.
        const memberRows = await db
          .select({ id: authMember.id })
          .from(authMember)
          .where(and(eq(authMember.userId, user.id), eq(authMember.organizationId, organizationId)))
          .limit(1)

        if (!memberRows[0]) {
          logger.warn({ userId: user.id, organizationId }, '[magic-finish] user is not a member of the organization')
          return c.html(renderErrorPage('Your account is not authorized for this organization.'), 403)
        }

        const session = await internalAdapter.createSession(user.id)
        if (!session) {
          logger.error({ userId: user.id, organizationId }, '[magic-finish] session creation failed')
          return c.html(renderErrorPage('An unexpected error occurred. Please try again.'), 500)
        }

        await internalAdapter.updateSession(session.token, { activeOrganizationId: organizationId })

        const expiresAt = session.expiresAt as Date
        const maxAgeSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
        const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
        const signedToken = await signSessionToken(session.token, authContext.secret)
        const cookieValue = `${SESSION_COOKIE_NAME}=${signedToken}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`

        logger.info({ userId: user.id, organizationId }, '[magic-finish] session created, redirecting')

        return new Response(null, {
          status: 302,
          headers: {
            'Set-Cookie': cookieValue,
            Location: safeRedirect,
            'Cache-Control': 'no-store',
          },
        })
      })
  )
}
