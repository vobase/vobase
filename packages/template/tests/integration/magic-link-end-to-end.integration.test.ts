/**
 * Integration tests for magic-verify-plugin — end-to-end verify + set-org flow.
 *
 * Uses a real Postgres database (docker compose up -d).
 * Mounts auth.handler in a minimal Hono app (same as bootstrap.ts) and fires
 * real HTTP requests at the plugin endpoints via app.fetch().
 *
 * Coverage:
 *   - POST /api/auth/verify-magic-link → 200 + correct response shape
 *   - Single-use enforcement: second verify → 400 INVALID_TOKEN
 *   - set-active-organization:
 *       - member of 2 orgs, set to orgA → 200 + activeOrganizationId updated in session row
 *       - non-member orgC → 403
 *
 * All tests share a single db:reset to avoid intra-file reset races.
 */

import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createNanoid } from '@vobase/core'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { createAuth } from '../../auth/index'
import { mintMagicLink } from '../../auth/magic-link'
import { authMember, authOrganization, authSession } from '../../auth/schema'
import { connectTestDb, resetAndSeedDb } from '../helpers/test-db'
import { signTestHmac } from './helpers/hmac-sign'

// ─── Constants ────────────────────────────────────────────────────────────────

const HMAC_SECRET = 'test-hmac-secret-magic-e2e-32chars!!'
const ALICE_USER_ID = 'usr0alice0'
const ALICE_EMAIL = 'alice@meridian.test'

// ─── App factory ─────────────────────────────────────────────────────────────

function buildAuthApp(auth: ReturnType<typeof createAuth>): Hono {
  const app = new Hono()
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))
  return app
}

// ─── HMAC POST helper ─────────────────────────────────────────────────────────

function signedPost(
  app: Hono,
  path: string,
  body: Record<string, unknown>,
  opts: { secret?: string; timestampMs?: number } = {},
): Promise<Response> {
  const secret = opts.secret ?? HMAC_SECRET
  const timestampMs = opts.timestampMs ?? Date.now()
  const bodyStr = JSON.stringify(body)
  const { headers } = signTestHmac({ method: 'POST', path, body: bodyStr, timestampMs, secret })
  return Promise.resolve(
    app.fetch(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers,
        body: bodyStr,
      }),
    ),
  )
}

function generateNonce(): string {
  return randomBytes(16).toString('base64url')
}

// ─── Shared setup ─────────────────────────────────────────────────────────────

// Single db handle + auth instance shared across all tests in this file.
// One resetAndSeedDb() call avoids intra-file race with the flock mutex.
const handle = connectTestDb()
let auth: ReturnType<typeof createAuth>
let app: Hono
let orgAId: string // Alice's seeded org
let orgBId: string // second org created in beforeAll

beforeAll(async () => {
  process.env.PLATFORM_HMAC_SECRET = HMAC_SECRET
  await resetAndSeedDb()
  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  auth = createAuth(handle.db as any)
  app = buildAuthApp(auth)

  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  const db = handle.db as any

  // Resolve Alice's seeded org (earliest auth.organization row)
  const [firstOrg] = await db.select({ id: authOrganization.id }).from(authOrganization).limit(1)
  orgAId = firstOrg.id

  // Create a second org and enroll Alice in it (for set-active-organization tests)
  orgBId = createNanoid()()
  await db.insert(authOrganization).values({
    id: orgBId,
    name: 'OrgB for set-org test',
    slug: `orgb-${orgBId.slice(0, 8)}`,
    createdAt: new Date(),
  })
  await db.insert(authMember).values({
    id: createNanoid()(),
    userId: ALICE_USER_ID,
    organizationId: orgBId,
    role: 'member',
    createdAt: new Date(),
  })
})

afterAll(async () => {
  delete process.env.PLATFORM_HMAC_SECRET
  await handle.teardown()
})

// ─── verify-magic-link tests ──────────────────────────────────────────────────

describe('verify-magic-link', () => {
  it('mints a token then verify-magic-link returns 200 + correct shape', async () => {
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      tenantId: 't1',
      organizationId: 'o1',
      redirectPath: '/inbox',
    })

    const res = await signedPost(app, '/api/auth/verify-magic-link', { token, nonce: generateNonce() })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      sessionToken: string
      userId: string
      expiresAt: string
      organizationId: string
    }
    expect(body.sessionToken).toBeTruthy()
    expect(body.userId).toBe(ALICE_USER_ID)
    expect(typeof body.expiresAt).toBe('string')
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now())
    // session.create.before hook sets activeOrganizationId from user's first membership
    expect(typeof body.organizationId).toBe('string')
  })

  it('single-use enforcement: second verify of same token → 400 INVALID_TOKEN', async () => {
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      tenantId: 't1',
      organizationId: 'o1',
      redirectPath: '/inbox',
    })

    // First use: must succeed
    const first = await signedPost(app, '/api/auth/verify-magic-link', { token, nonce: generateNonce() })
    expect(first.status).toBe(200)

    // Second use: same token, fresh nonce — must be rejected
    const second = await signedPost(app, '/api/auth/verify-magic-link', { token, nonce: generateNonce() })
    expect(second.status).toBe(400)
    const errBody = (await second.json()) as { message?: string; error?: string; code?: string }
    const errStr = JSON.stringify(errBody).toLowerCase()
    expect(errStr).toContain('invalid_token')
  })
})

// ─── set-active-organization tests ───────────────────────────────────────────

describe('set-active-organization', () => {
  it('member of 2 orgs: set active to orgA → 200 + organizationId updated in session row', async () => {
    // Mint + verify to get a real sessionToken
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      tenantId: 't1',
      organizationId: orgAId,
      redirectPath: '/inbox',
    })
    const verifyRes = await signedPost(app, '/api/auth/verify-magic-link', { token, nonce: generateNonce() })
    expect(verifyRes.status).toBe(200)
    const { sessionToken } = (await verifyRes.json()) as { sessionToken: string }

    // Force activeOrganizationId to orgB so we can verify the update flips it to orgA
    // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
    const db = handle.db as any
    await db.update(authSession).set({ activeOrganizationId: orgBId }).where(eq(authSession.token, sessionToken))

    // Set active org to orgA via the HMAC endpoint
    const setRes = await signedPost(app, '/api/auth/set-active-organization', {
      sessionToken,
      organizationId: orgAId,
      nonce: generateNonce(),
    })
    expect(setRes.status).toBe(200)
    const setBody = (await setRes.json()) as { ok: boolean; activeOrganizationId: string }
    expect(setBody.ok).toBe(true)
    expect(setBody.activeOrganizationId).toBe(orgAId)

    // Verify the session row in the DB reflects the update
    const [sessionRow] = await db
      .select({ activeOrganizationId: authSession.activeOrganizationId })
      .from(authSession)
      .where(eq(authSession.token, sessionToken))
      .limit(1)
    expect(sessionRow?.activeOrganizationId).toBe(orgAId)
  })

  it('non-member organization → 403 not_a_member', async () => {
    // Mint + verify to get a sessionToken
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      tenantId: 't1',
      organizationId: orgAId,
      redirectPath: '/inbox',
    })
    const verifyRes = await signedPost(app, '/api/auth/verify-magic-link', { token, nonce: generateNonce() })
    expect(verifyRes.status).toBe(200)
    const { sessionToken } = (await verifyRes.json()) as { sessionToken: string }

    // orgCId does not exist; Alice is not a member
    const orgCId = 'org-does-not-exist-xyz'
    const setRes = await signedPost(app, '/api/auth/set-active-organization', {
      sessionToken,
      organizationId: orgCId,
      nonce: generateNonce(),
    })
    expect(setRes.status).toBe(403)
    const errBody = (await setRes.json()) as { message?: string; error?: string }
    const errStr = JSON.stringify(errBody).toLowerCase()
    expect(errStr).toContain('not_a_member')
  })
})
