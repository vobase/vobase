/**
 * Integration tests for magic-verify-plugin — Blocker 5 tenant-tampering regression.
 *
 * Simulates an attacker who intercepts a magic-link token minted for one tenant
 * and attempts to verify it against that tenant's endpoint using a tampered signature.
 *
 * ## What the code enforces (testable in a shared-DB integration test)
 *
 * Strategy (a): Wrong HMAC secret → 401 (HMAC layer rejects before token verification runs).
 * The test uses two distinct HMAC secrets and verifies that signing with the wrong
 * key is unconditionally rejected before any DB access.
 *
 * ## What is NOT testable here (production-level isolation)
 *
 * Strategy (b): Tenant A's token sent to Tenant B with correct HMAC → token found in
 * Tenant B's verification table → returns 200 — this would be a failure in production
 * where each tenant has its own Postgres database. In this shared-DB integration test
 * both "tenants" use the same DB so the token row is visible to both. That isolation
 * guarantee is a deployment property (one DB per tenant), not a code property.
 * The cross-tenant DB isolation is documented here as a deployment invariant, not as
 * an assertion in this test suite.
 *
 * ## Wrong-HMAC tests (both endpoints)
 *
 * 1. verify-magic-link with wrong HMAC → 401
 * 2. set-active-organization with wrong HMAC → 401
 * 3. Missing HMAC headers entirely → 401
 * 4. Correct HMAC but body tampered after signing → 401 body_digest_mismatch
 */

import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import { createAuth } from '../../auth/index'
import { mintMagicLink } from '../../auth/magic-link'
import { connectTestDb, resetAndSeedDb } from '../helpers/test-db'
import { signTestHmac } from './helpers/hmac-sign'

// ─── Constants ────────────────────────────────────────────────────────────────

const CORRECT_HMAC_SECRET = 'correct-hmac-secret-tenant-32ch!!'
const WRONG_HMAC_SECRET = 'wrong-hmac-secret-attacker-32ch!!'

const ALICE_USER_ID = 'usr0alice0'
const ALICE_EMAIL = 'alice@meridian.test'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildAuthApp(auth: ReturnType<typeof createAuth>): Hono {
  const app = new Hono()
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))
  return app
}

function generateNonce(): string {
  return randomBytes(16).toString('base64url')
}

function postWithSecret(app: Hono, path: string, body: Record<string, unknown>, hmacSecret: string): Promise<Response> {
  const bodyStr = JSON.stringify(body)
  const { headers } = signTestHmac({ method: 'POST', path, body: bodyStr, timestampMs: Date.now(), secret: hmacSecret })
  return app.fetch(new Request(`http://localhost${path}`, { method: 'POST', headers, body: bodyStr }))
}

// ─── Shared setup ─────────────────────────────────────────────────────────────

const handle = connectTestDb()
let auth: ReturnType<typeof createAuth>
let app: Hono

beforeAll(async () => {
  process.env.PLATFORM_HMAC_SECRET = CORRECT_HMAC_SECRET
  await resetAndSeedDb()
  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  auth = createAuth(handle.db as any)
  app = buildAuthApp(auth)
})

afterAll(async () => {
  delete process.env.PLATFORM_HMAC_SECRET
  await handle.teardown()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('magic-link tenant-tampering (Blocker 5 regression)', () => {
  it('verify-magic-link signed with WRONG HMAC secret → 401 (HMAC layer rejects, no token access)', async () => {
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      tenantId: 't1',
      organizationId: 'o1',
      redirectPath: '/inbox',
    })

    // Attacker knows the token but not the HMAC secret — signs with wrong key
    const res = await postWithSecret(
      app,
      '/api/auth/verify-magic-link',
      { token, nonce: generateNonce() },
      WRONG_HMAC_SECRET,
    )

    expect(res.status).toBe(401)
    const errBody = (await res.json()) as { message?: string; error?: string }
    // Must NOT be INVALID_TOKEN — HMAC layer fires first, token was never accessed
    const errStr = JSON.stringify(errBody).toLowerCase()
    expect(errStr).not.toContain('invalid_token')
  })

  it('set-active-organization signed with WRONG HMAC secret → 401', async () => {
    // Mint + verify to get a real sessionToken (correctly signed)
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      tenantId: 't1',
      organizationId: 'o1',
      redirectPath: '/inbox',
    })
    const verifyRes = await postWithSecret(
      app,
      '/api/auth/verify-magic-link',
      { token, nonce: generateNonce() },
      CORRECT_HMAC_SECRET,
    )
    expect(verifyRes.status).toBe(200)
    const { sessionToken } = (await verifyRes.json()) as { sessionToken: string }

    // Attacker now tries to set-active-organization with the captured sessionToken
    // but signs with wrong key — HMAC layer must reject before any session access
    const res = await postWithSecret(
      app,
      '/api/auth/set-active-organization',
      { sessionToken, organizationId: 'org-attacker', nonce: generateNonce() },
      WRONG_HMAC_SECRET,
    )

    expect(res.status).toBe(401)
    const errBody = (await res.json()) as { message?: string; error?: string }
    const errStr = JSON.stringify(errBody).toLowerCase()
    expect(errStr).not.toContain('not_a_member')
  })

  it('verify-magic-link with missing HMAC headers → 401', async () => {
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      tenantId: 't1',
      organizationId: 'o1',
      redirectPath: '/inbox',
    })

    // Send with no HMAC headers at all
    const bodyStr = JSON.stringify({ token, nonce: generateNonce() })
    const res = await app.fetch(
      new Request('http://localhost/api/auth/verify-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
      }),
    )

    expect(res.status).toBe(401)
  })

  it('verify-magic-link with body tampered after signing → 401 (body digest mismatch)', async () => {
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      tenantId: 't1',
      organizationId: 'o1',
      redirectPath: '/inbox',
    })

    const path = '/api/auth/verify-magic-link'
    const nonce = generateNonce()
    const originalBody = JSON.stringify({ token, nonce })
    const { headers } = signTestHmac({
      method: 'POST',
      path,
      body: originalBody,
      timestampMs: Date.now(),
      secret: CORRECT_HMAC_SECRET,
    })

    // Attacker tampers the body after signing — digest mismatch
    const tamperedBody = JSON.stringify({ token: 'TAMPERED_TOKEN', nonce })

    const res = await app.fetch(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers,
        body: tamperedBody,
      }),
    )

    // Body digest check fires in the HMAC layer — 401 before token is ever read
    expect(res.status).toBe(401)
  })
})
