/**
 * Integration tests for auth/magic-finish.ts — createMagicFinishRoutes.
 *
 * Requires a running Postgres on :5432 (docker compose up -d).
 * Resets and seeds the DB via resetAndSeedDb() in beforeAll.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'

import { connectTestDb, resetAndSeedDb } from '../tests/helpers/test-db'
import { createAuth } from './index'
import { createMagicFinishRoutes } from './magic-finish'
import { mintMagicLink } from './magic-link'
import { authOrganization, authVerification } from './schema'

const ALICE_USER_ID = 'usr0alice0'
const ALICE_EMAIL = 'alice@meridian.test'

/** SHA-256 → base64url (no padding) — mirrors magic-finish.ts hashToken. */
async function hashToken(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Buffer.from(hash).toString('base64url').replace(/=/g, '')
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

  it('happy path: 302 with session cookie and correct headers', async () => {
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      endpointId: 't1',
      organizationId: orgId,
      redirectPath: '/inbox',
    })

    const res = await app.request(
      `/?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent('/inbox')}&organization=${encodeURIComponent(orgId)}`,
    )

    expect(res.status).toBe(302)

    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain('better-auth.session_token=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    // Domain= must NOT appear
    expect(setCookie).not.toContain('Domain=')

    expect(res.headers.get('location')).toBe('/inbox')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  // ── Test 2: Replay rejected ─────────────────────────────────────────────────

  it('replay rejected: second call returns 400 with no Set-Cookie', async () => {
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      endpointId: 't1',
      organizationId: orgId,
      redirectPath: '/inbox',
    })

    const query = `/?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent('/inbox')}&organization=${encodeURIComponent(orgId)}`

    const first = await app.request(query)
    expect(first.status).toBe(302)

    const second = await app.request(query)
    expect(second.status).toBe(400)
    expect(second.headers.get('set-cookie')).toBeNull()
    const body = await second.text()
    expect(body).toContain('already been used or has expired')
  })

  // ── Test 3: Expired token ───────────────────────────────────────────────────

  it('expired token: 400 with expired message and verification row is gone', async () => {
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      endpointId: 't1',
      organizationId: orgId,
      redirectPath: '/inbox',
    })

    // Backdate the verification row using the hashed identifier.
    const hashed = await hashToken(token)
    const internalAdapter = (await auth.$context).internalAdapter
    await internalAdapter.updateVerificationByIdentifier(hashed, { expiresAt: new Date(Date.now() - 1000) })

    const res = await app.request(
      `/?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent('/inbox')}&organization=${encodeURIComponent(orgId)}`,
    )

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

  // ── Test 4: Org membership rejection ───────────────────────────────────────

  it('org non-member: 403 with not-authorized message and no Set-Cookie', async () => {
    // Mint with the "other" org that Alice is NOT a member of.
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      endpointId: 't1',
      organizationId: 'org-other-test',
      redirectPath: '/inbox',
    })

    const res = await app.request(
      `/?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent('/inbox')}&organization=${encodeURIComponent('org-other-test')}`,
    )

    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
    const body = await res.text()
    expect(body).toContain('not authorized for this organization')
  })

  // ── Test 5: Unsafe redirect falls back to `/` ───────────────────────────────

  it('unsafe redirect: absolute and protocol-relative URLs fall back to /', async () => {
    const cases = ['//evil.com', 'http://evil.com', 'javascript:alert(1)']

    for (const badRedirect of cases) {
      const { token } = await mintMagicLink(auth, handle.db, {
        userId: ALICE_USER_ID,
        email: ALICE_EMAIL,
        endpointId: 't1',
        organizationId: orgId,
        redirectPath: '/inbox',
      })

      const res = await app.request(
        `/?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(badRedirect)}&organization=${encodeURIComponent(orgId)}`,
      )

      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/')
    }
  })

  // ── Test 6: Missing query params ────────────────────────────────────────────

  it('missing params: 400 with noindex meta in body', async () => {
    const res = await app.request('/?token=x')

    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain('<meta name="robots" content="noindex">')
  })

  // ── Test 7: Ownership challenge probe ───────────────────────────────────────

  it('challenge probe: a bare ?challenge= (no token) echoes the challenge', async () => {
    const probe = await app.request('/?challenge=abc-123')
    expect(probe.status).toBe(200)
    expect(await probe.text()).toBe('abc-123')
  })
})
