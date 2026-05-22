/**
 * Integration tests for auth/magic-finish.ts — createMagicFinishRoutes.
 *
 * Requires a running Postgres on :5432 (docker compose up -d).
 * Resets and seeds the DB via resetAndSeedDb() in beforeAll.
 *
 * The route is two-step: GET renders an interstitial without touching the
 * token; POST performs the single-use consume. Tests drive the POST directly
 * (the real browser auto-submits the GET interstitial's form).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb } from '../tests/helpers/test-db'
import { createAuth } from './index'
import { createMagicFinishRoutes } from './magic-finish'
import { mintMagicLink } from './magic-link'
import { authOrganization, authVerification } from './schema'

// `mintMagicLink` signs the platform-redirect URL with these env vars.
process.env.VITE_PLATFORM_TENANT_SLUG ??= 'test-tenant'
process.env.PLATFORM_HMAC_SECRET ??= 'test-platform-hmac-secret-32chars!!'

const ALICE_USER_ID = 'usr0alice0'
const ALICE_EMAIL = 'alice@meridian.test'

/** SHA-256 → base64url (no padding) — mirrors magic-finish.ts hashToken. */
async function hashToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Buffer.from(hash).toString('base64url').replace(/=/g, '')
}

/** POST the interstitial form fields to the consume endpoint, as a real browser would. */
async function finishPost(
  app: ReturnType<typeof createMagicFinishRoutes>,
  params: { token: string; redirect: string; organization: string },
): Promise<Response> {
  return app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
}

describe('createMagicFinishRoutes', () => {
  const handle = connectTestDb()
  let auth: ReturnType<typeof createAuth>
  let app: ReturnType<typeof createMagicFinishRoutes>
  let orgId: string

  beforeAll(async () => {
    await resetAndSeedDb()
    auth = createAuth(handle.db as Parameters<typeof createAuth>[0])
    app = createMagicFinishRoutes(auth, handle.db as Parameters<typeof createMagicFinishRoutes>[1])

    // Resolve the seeded org id dynamically (it is derived from PLATFORM_TENANT_ID
    // or a fresh nanoid at db:reset time — never hard-coded).
    const [org] = await handle.db.select({ id: authOrganization.id }).from(authOrganization).limit(1)
    if (!org) throw new Error('No org found after seed — db:reset may have failed')
    orgId = org.id

    // Seed a second "other" org that Alice is NOT a member of (used in test 4).
    await handle.db
      .insert(authOrganization)
      .values({ id: 'org-other-test', slug: 'other-test', name: 'Other Org Test', createdAt: new Date() })
      .onConflictDoNothing()
  })

  afterAll(async () => {
    await handle.teardown()
  })

  // ── Test 1: Happy path ──────────────────────────────────────────────────────

  it('happy path: POST 302s with a signed session cookie and correct headers', async () => {
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      organizationId: orgId,
      redirectPath: '/inbox',
    })

    const res = await finishPost(app, { token, redirect: '/inbox', organization: orgId })

    expect(res.status).toBe(302)

    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain('better-auth.session_token=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    // Domain= must NOT appear
    expect(setCookie).not.toContain('Domain=')

    // The cookie value must be SIGNED — better-auth writes the session token
    // via `setSignedCookie` and rejects an unsigned value on read. Verify the
    // value round-trips as `<token>.<base64 HMAC>` and the HMAC checks out
    // against the better-auth secret.
    const secret = (await auth.$context).secret
    const rawCookie = setCookie?.match(/better-auth\.session_token=([^;]+)/)?.[1] ?? ''
    const decoded = decodeURIComponent(rawCookie)
    const lastDot = decoded.lastIndexOf('.')
    expect(lastDot).toBeGreaterThan(0)
    const signedValue = decoded.slice(0, lastDot)
    const sigBytes = Uint8Array.from(atob(decoded.slice(lastDot + 1)), (ch) => ch.charCodeAt(0))
    const verifyKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const sigValid = await crypto.subtle.verify('HMAC', verifyKey, sigBytes, new TextEncoder().encode(signedValue))
    expect(sigValid).toBe(true)

    expect(res.headers.get('location')).toBe('/inbox')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  // ── Test 2: GET is prefetch-safe — does not consume the token ────────────────

  it('GET renders an interstitial without consuming the token', async () => {
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      organizationId: orgId,
      redirectPath: '/inbox',
    })

    const query = `/?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent('/inbox')}&organization=${encodeURIComponent(orgId)}`

    // A GET (e.g. a link-preview crawler) returns the interstitial, status 200.
    const getRes = await app.request(query)
    expect(getRes.status).toBe(200)
    const html = await getRes.text()
    expect(html).toContain('method="POST"')
    expect(html).toContain('magic-finish-form')

    // The verification row must still be present — GET did not consume it.
    const hashed = await hashToken(token)
    const rows = await handle.db
      .select({ id: authVerification.id })
      .from(authVerification)
      .where(eq(authVerification.identifier, hashed))
    expect(rows.length).toBe(1)

    // Even after the crawler's GET, the human's POST still succeeds.
    const postRes = await finishPost(app, { token, redirect: '/inbox', organization: orgId })
    expect(postRes.status).toBe(302)
  })

  // ── Test 3: Replay rejected ─────────────────────────────────────────────────

  it('replay rejected: second POST returns 400 with no Set-Cookie', async () => {
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      organizationId: orgId,
      redirectPath: '/inbox',
    })

    const first = await finishPost(app, { token, redirect: '/inbox', organization: orgId })
    expect(first.status).toBe(302)

    const second = await finishPost(app, { token, redirect: '/inbox', organization: orgId })
    expect(second.status).toBe(400)
    expect(second.headers.get('set-cookie')).toBeNull()
    const body = await second.text()
    expect(body).toContain('already been used or has expired')
  })

  // ── Test 4: Expired token ───────────────────────────────────────────────────

  it('expired token: 400 with expired message and verification row is gone', async () => {
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      organizationId: orgId,
      redirectPath: '/inbox',
    })

    // Backdate the verification row using the hashed identifier.
    const hashed = await hashToken(token)
    const internalAdapter = (await auth.$context).internalAdapter
    await internalAdapter.updateVerificationByIdentifier(hashed, { expiresAt: new Date(Date.now() - 1000) })

    const res = await finishPost(app, { token, redirect: '/inbox', organization: orgId })

    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body.toLowerCase()).toContain('expired')

    // consumeVerificationValue deletes on read — row must be gone.
    const rows = await handle.db
      .select({ id: authVerification.id })
      .from(authVerification)
      .where(eq(authVerification.identifier, hashed))
    expect(rows.length).toBe(0)
  })

  // ── Test 5: Org membership rejection ───────────────────────────────────────

  it('org non-member: 403 with not-authorized message and no Set-Cookie', async () => {
    // Mint with the "other" org that Alice is NOT a member of.
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      organizationId: 'org-other-test',
      redirectPath: '/inbox',
    })

    const res = await finishPost(app, { token, redirect: '/inbox', organization: 'org-other-test' })

    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
    const body = await res.text()
    expect(body).toContain('not authorized for this organization')
  })

  // ── Test 6: Unsafe redirect falls back to `/` ───────────────────────────────

  it('unsafe redirect: absolute and protocol-relative URLs fall back to /', async () => {
    const cases = ['//evil.com', 'http://evil.com', 'javascript:alert(1)']

    for (const badRedirect of cases) {
      const { token } = await mintMagicLink(auth, handle.db, {
        userId: ALICE_USER_ID,
        email: ALICE_EMAIL,
        organizationId: orgId,
        redirectPath: '/inbox',
      })

      const res = await finishPost(app, { token, redirect: badRedirect, organization: orgId })

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/')
    }
  })

  // ── Test 7: Missing params ──────────────────────────────────────────────────

  it('missing params: GET 400 with noindex meta, POST 400', async () => {
    const getRes = await app.request('/?token=x')
    expect(getRes.status).toBe(400)
    const getBody = await getRes.text()
    expect(getBody).toContain('<meta name="robots" content="noindex">')

    const postRes = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: 'x' }).toString(),
    })
    expect(postRes.status).toBe(400)
  })
})
