/**
 * Integration tests for magic-verify-plugin — HMAC replay + timestamp-window rejection.
 *
 * Uses a real Postgres database (docker compose up -d).
 *
 * Coverage:
 *   1. Valid HMAC POST → 200
 *   2. Same nonce replayed (different valid token) → 409 replay_rejected; token2 NOT consumed
 *   3. X-Vobase-Timestamp > 5 min in the past → 401 timestamp_window_rejected
 */

import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

import { createAuth } from '../../auth/index'
import { mintMagicLink } from '../../auth/magic-link'
import { connectTestDb, resetAndSeedDb } from '../helpers/test-db'
import { signTestHmac } from './helpers/hmac-sign'

// ─── Constants ────────────────────────────────────────────────────────────────

const HMAC_SECRET = 'test-hmac-secret-replay-32chars!!!!'
const ALICE_USER_ID = 'usr0alice0'
const ALICE_EMAIL = 'alice@meridian.test'

// ─── App factory ─────────────────────────────────────────────────────────────

function buildAuthApp(auth: ReturnType<typeof createAuth>): Hono {
  const app = new Hono()
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))
  return app
}

function generateNonce(): string {
  return randomBytes(16).toString('base64url')
}

// ─── Shared setup (single resetAndSeedDb to avoid intra-file races) ───────────

const handle = connectTestDb()
let auth: ReturnType<typeof createAuth>
let app: Hono

beforeAll(async () => {
  process.env.PLATFORM_HMAC_SECRET = HMAC_SECRET
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

describe('magic-link HMAC replay + timestamp-window rejection', () => {
  it('valid HMAC POST → 200', async () => {
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      tenantId: 't1',
      organizationId: 'o1',
      redirectPath: '/inbox',
    })

    const path = '/api/auth/verify-magic-link'
    const nonce = generateNonce()
    const bodyStr = JSON.stringify({ token, nonce })
    const { headers } = signTestHmac({
      method: 'POST',
      path,
      body: bodyStr,
      timestampMs: Date.now(),
      secret: HMAC_SECRET,
    })

    const res = await app.fetch(new Request(`http://localhost${path}`, { method: 'POST', headers, body: bodyStr }))
    expect(res.status).toBe(200)
  })

  it('replay of same nonce (different token) → 409 replay_rejected; token2 NOT consumed', async () => {
    // Mint two tokens so token2 would pass token-verify if replay wasn't blocked
    const { token: token1 } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      tenantId: 't1',
      organizationId: 'o1',
      redirectPath: '/inbox',
    })
    const { token: token2 } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      tenantId: 't1',
      organizationId: 'o1',
      redirectPath: '/inbox',
    })

    const path = '/api/auth/verify-magic-link'
    // Same nonce for both requests — triggers the replay guard
    const sharedNonce = generateNonce()

    const body1Str = JSON.stringify({ token: token1, nonce: sharedNonce })
    const { headers: headers1 } = signTestHmac({
      method: 'POST',
      path,
      body: body1Str,
      timestampMs: Date.now(),
      secret: HMAC_SECRET,
    })

    // First request: valid HMAC + fresh nonce → 200
    const res1 = await app.fetch(
      new Request(`http://localhost${path}`, { method: 'POST', headers: headers1, body: body1Str }),
    )
    expect(res1.status).toBe(200)

    // Second request: different valid token but SAME nonce — replay guard fires before token verify
    const body2Str = JSON.stringify({ token: token2, nonce: sharedNonce })
    const { headers: headers2 } = signTestHmac({
      method: 'POST',
      path,
      body: body2Str,
      timestampMs: Date.now(),
      secret: HMAC_SECRET,
    })

    const res2 = await app.fetch(
      new Request(`http://localhost${path}`, { method: 'POST', headers: headers2, body: body2Str }),
    )
    expect(res2.status).toBe(409)
    const errBody = (await res2.json()) as { message?: string; error?: string }
    const errStr = JSON.stringify(errBody).toLowerCase()
    expect(errStr).toContain('replay_rejected')

    // Token2 was NOT consumed (replay guard fired before token-verify).
    // Verify: re-use token2 with a fresh nonce → should succeed (200).
    const body3Str = JSON.stringify({ token: token2, nonce: generateNonce() })
    const { headers: headers3 } = signTestHmac({
      method: 'POST',
      path,
      body: body3Str,
      timestampMs: Date.now(),
      secret: HMAC_SECRET,
    })
    const res3 = await app.fetch(
      new Request(`http://localhost${path}`, { method: 'POST', headers: headers3, body: body3Str }),
    )
    expect(res3.status).toBe(200)
  })

  it('X-Vobase-Timestamp 10 min in the past → 401 timestamp_window_rejected', async () => {
    const { token } = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      tenantId: 't1',
      organizationId: 'o1',
      redirectPath: '/inbox',
    })

    const path = '/api/auth/verify-magic-link'
    const nonce = generateNonce()
    const bodyStr = JSON.stringify({ token, nonce })
    // Timestamp 10 minutes in the past — well outside the ±5 min window
    const staleTimestampMs = Date.now() - 10 * 60_000
    const { headers } = signTestHmac({
      method: 'POST',
      path,
      body: bodyStr,
      timestampMs: staleTimestampMs,
      secret: HMAC_SECRET,
    })

    const res = await app.fetch(new Request(`http://localhost${path}`, { method: 'POST', headers, body: bodyStr }))
    expect(res.status).toBe(401)
    const errBody = (await res.json()) as { message?: string; error?: string }
    const errStr = JSON.stringify(errBody).toLowerCase()
    expect(errStr).toContain('timestamp_window_rejected')
  })
})
