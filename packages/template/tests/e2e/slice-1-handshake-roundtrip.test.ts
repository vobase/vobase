/**
 * Slice 1 — handshake round-trip e2e (US-008)
 *
 * Boots a tiny in-process Hono platform stub that exposes the same
 * `/api/managed-whatsapp/health` route that `fetchSandboxAvailability`
 * calls in production. Verifies the v2 2-key HMAC contract end-to-end:
 *
 *   1. The tenant side (`fetchSandboxAvailability`) signs the outbound GET
 *      with `signRequest` from `@vobase/core`.
 *   2. The platform stub re-derives the canonical v2 payload and verifies
 *      both routine + rotation signatures via `verifyRequest` from
 *      `@vobase/core` — the SAME primitives used by the real platform.
 *   3. The stub returns the full availability payload only when auth passes,
 *      and strips data fields (bare `{ok:true}`) on auth failure — mirroring
 *      the documented platform contract.
 *
 * No live network, no live DB. Uses `app.fetch` to dispatch in-process.
 * The HMAC secret is a deterministic test fixture so the test is fully
 * reproducible without any env variables.
 */

import { describe, expect, it } from 'bun:test'
import { signRequest, verifyRequest } from '@vobase/core'
import { Hono } from 'hono'

import { sha256Hex, splitPathAndQuery } from '../../modules/channels/adapters/whatsapp/managed-transport'
import {
  fetchSandboxAvailability,
  isAllowedPlatformBaseUrl,
  PlatformHandshakeError,
} from '../../modules/integrations/service/handshake'

// ─── Test fixtures ────────────────────────────────────────────────────────────

const TENANT_ID = 'tst0tenant1'
const HMAC_SECRET = 'test-fixture-hmac-secret-slice1-us008' // deterministic; never rotated
const KEY_VERSION = 1
const SANDBOX_POOL_AVAILABLE = 3
const SCHEMA_VERSION = 'v2'

// ─── Platform stub ────────────────────────────────────────────────────────────

/**
 * Minimal in-process platform stub. Implements the `/api/managed-whatsapp/health`
 * contract:
 *   - Verifies the v2 2-key HMAC headers on every request.
 *   - Returns `{ ok: true, sandboxPoolAvailable, schemaVersion }` on auth success.
 *   - Returns bare `{ ok: true }` (no data fields) on auth failure — documented
 *     signal that causes `fetchSandboxAvailability` to throw `platform_unauthenticated`.
 */
function buildPlatformStub(opts: { secret: string; rejectAuth?: boolean }): Hono {
  const app = new Hono()

  app.get('/api/managed-whatsapp/health', (c) => {
    const routineSig = c.req.header('X-Vobase-Routine-Sig')
    const rotationSig = c.req.header('X-Vobase-Rotation-Sig')
    const keyVersionRaw = c.req.header('X-Vobase-Key-Version')
    const sigVersion = c.req.header('X-Vobase-Sig-Version')

    // If test wants to simulate an unrecognised tenant, skip auth and return bare ok.
    if (opts.rejectAuth) {
      return c.json({ ok: true })
    }

    // Require all v2 headers to be present.
    if (!routineSig || !rotationSig || !keyVersionRaw || sigVersion !== '2') {
      return c.json({ ok: true }) // bare ok — same as "tenant unknown"
    }

    const keyVersion = Number.parseInt(keyVersionRaw, 10)
    if (!Number.isFinite(keyVersion)) return c.json({ ok: true })

    // Re-derive the canonical v2 payload from the incoming request.
    const url = new URL(c.req.url)
    const { pathOnly, sortedQuery } = splitPathAndQuery(url.pathname + url.search)
    const bodyDigest = sha256Hex('') // GET has no body
    const v2Payload = `GET|${pathOnly}|${sortedQuery}|${bodyDigest}`

    const result = verifyRequest({
      body: v2Payload,
      routineSignature: routineSig,
      rotationSignature: rotationSig,
      keyVersion,
      maxKeyVersionSeen: 0,
      accept: [{ routineSecret: opts.secret, rotationKey: opts.secret, keyVersion: KEY_VERSION }],
    })

    if (!result.ok) {
      // Auth failed — return bare ok (no data fields), same as production platform.
      return c.json({ ok: true })
    }

    return c.json({
      ok: true,
      sandboxPoolAvailable: SANDBOX_POOL_AVAILABLE,
      schemaVersion: SCHEMA_VERSION,
    })
  })

  return app
}

/**
 * Adapter that forwards `fetch(url, init)` to `app.fetch()` in-process.
 * Patches global `fetch` for the duration of a callback, then restores it.
 */
async function withInProcessFetch(app: Hono, baseUrl: string, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch

  // Build a callable that satisfies `typeof globalThis.fetch` — which carries
  // extra static properties (`preconnect`) on top of the call signature. We
  // Object.assign the original onto our wrapper to inherit those properties.
  type FetchFn = typeof globalThis.fetch
  const wrapper: FetchFn = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(baseUrl)) {
      const req = new Request(url, init)
      return Promise.resolve(app.fetch(req))
    }
    // Any other URL falls through to the real fetch — should never happen in
    // these tests. A deliberate throw would cause confusing failures if the
    // URL is slightly different; the real fetch will just time-out / ECONNREFUSED
    // and surface a clear error instead.
    return original(input, init)
  }) as FetchFn
  globalThis.fetch = Object.assign(wrapper, original) as FetchFn

  try {
    await fn()
  } finally {
    globalThis.fetch = original
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('slice-1 handshake round-trip (v2 only, in-process)', () => {
  const BASE_URL = 'http://localhost:9999' // never bound; in-process only

  it('isAllowedPlatformBaseUrl allows localhost in non-production', () => {
    // Sanity-check before the full round-trip: the URL-allowlist helper must
    // accept `localhost` so the test can actually reach the stub.
    expect(isAllowedPlatformBaseUrl(BASE_URL)).toBe(true)
  })

  it('v2 round-trip succeeds: correct secret → full payload returned', async () => {
    const stub = buildPlatformStub({ secret: HMAC_SECRET })

    let result: { sandboxPoolAvailable: number; schemaVersion: string } | undefined

    await withInProcessFetch(stub, BASE_URL, async () => {
      result = await fetchSandboxAvailability({
        platformBaseUrl: BASE_URL,
        tenantId: TENANT_ID,
        tenantHmacSecret: HMAC_SECRET,
      })
    })

    expect(result).toBeDefined()
    expect(result?.sandboxPoolAvailable).toBe(SANDBOX_POOL_AVAILABLE)
    expect(result?.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('wrong secret → PlatformHandshakeError platform_unauthenticated', async () => {
    const stub = buildPlatformStub({ secret: 'correct-secret-on-platform-side' })

    await withInProcessFetch(stub, BASE_URL, async () => {
      await expect(
        fetchSandboxAvailability({
          platformBaseUrl: BASE_URL,
          tenantId: TENANT_ID,
          tenantHmacSecret: 'wrong-secret-on-tenant-side',
        }),
      ).rejects.toThrow(PlatformHandshakeError)

      try {
        await fetchSandboxAvailability({
          platformBaseUrl: BASE_URL,
          tenantId: TENANT_ID,
          tenantHmacSecret: 'wrong-secret-on-tenant-side',
        })
      } catch (err) {
        expect(err).toBeInstanceOf(PlatformHandshakeError)
        expect((err as PlatformHandshakeError).code).toBe('platform_unauthenticated')
      }
    })
  })

  it('platform explicitly rejects tenant → PlatformHandshakeError platform_unauthenticated', async () => {
    const stub = buildPlatformStub({ secret: HMAC_SECRET, rejectAuth: true })

    await withInProcessFetch(stub, BASE_URL, async () => {
      try {
        await fetchSandboxAvailability({
          platformBaseUrl: BASE_URL,
          tenantId: TENANT_ID,
          tenantHmacSecret: HMAC_SECRET,
        })
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(PlatformHandshakeError)
        expect((err as PlatformHandshakeError).code).toBe('platform_unauthenticated')
      }
    })
  })

  it('signRequest + verifyRequest form a consistent v2 round-trip without fetchSandboxAvailability', () => {
    // Unit-level sanity: the signing primitives are symmetric.
    // This test documents the canonical v2 payload shape so the contract is
    // visible in the test file itself, not just in production code comments.
    const path = '/api/managed-whatsapp/health'
    const { pathOnly, sortedQuery } = splitPathAndQuery(path)
    const bodyDigest = sha256Hex('')
    const v2Payload = `GET|${pathOnly}|${sortedQuery}|${bodyDigest}`

    const signed = signRequest({
      body: v2Payload,
      routineSecret: HMAC_SECRET,
      rotationKey: HMAC_SECRET,
      keyVersion: KEY_VERSION,
    })

    const result = verifyRequest({
      body: v2Payload,
      routineSignature: signed.routineSignature,
      rotationSignature: signed.rotationSignature,
      keyVersion: signed.keyVersion,
      maxKeyVersionSeen: 0,
      accept: [{ routineSecret: HMAC_SECRET, rotationKey: HMAC_SECRET, keyVersion: KEY_VERSION }],
    })

    expect(result.ok).toBe(true)
  })

  it('tampered path invalidates v2 signature', () => {
    // Regression guard: a tampered URL must invalidate the signature because
    // the canonical payload includes pathOnly.
    const path = '/api/managed-whatsapp/health'
    const { pathOnly, sortedQuery } = splitPathAndQuery(path)
    const bodyDigest = sha256Hex('')
    const v2Payload = `GET|${pathOnly}|${sortedQuery}|${bodyDigest}`

    const signed = signRequest({
      body: v2Payload,
      routineSecret: HMAC_SECRET,
      rotationKey: HMAC_SECRET,
      keyVersion: KEY_VERSION,
    })

    // Reconstruct with a *different* path — simulates URL tampering.
    const tamperedPath = '/api/managed-whatsapp/health/injected'
    const { pathOnly: tp, sortedQuery: tq } = splitPathAndQuery(tamperedPath)
    const tamperedPayload = `GET|${tp}|${tq}|${bodyDigest}`

    const result = verifyRequest({
      body: tamperedPayload,
      routineSignature: signed.routineSignature,
      rotationSignature: signed.rotationSignature,
      keyVersion: KEY_VERSION,
      maxKeyVersionSeen: 0,
      accept: [{ routineSecret: HMAC_SECRET, rotationKey: HMAC_SECRET, keyVersion: KEY_VERSION }],
    })

    expect(result.ok).toBe(false)
  })
})
