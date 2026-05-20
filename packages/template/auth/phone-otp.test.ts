/**
 * Integration tests for auth/phone-otp.ts — mintPhoneOtp + captor.
 *
 * Requires a running Postgres on :5432 (docker compose up -d).
 * Each describe resets and seeds the DB via resetAndSeedDb().
 *
 * The platform `/api/managed-whatsapp/otp` endpoint is stubbed via global `fetch`
 * monkeypatch — US-018 ships the real endpoint in a parallel slice; until then
 * the tests assert only that the captor produces a 6-digit code and the
 * platform POST carries the expected `{staffPhoneE164, code, expiresInSec}`
 * body shape under the HMAC v2 signing path.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'

import { connectTestDb, resetAndSeedDb } from '../tests/helpers/test-db'
import { createAuth } from './index'
import { mintPhoneOtp, PhoneOtpMintError } from './phone-otp'

// ─── Per-test mock seam: getNotificationSettings ─────────────────────────────
// Each test sets `_settingsOverride` to control the per-org notification
// settings returned to the production code path. `mock.module` is set once at
// file scope so the stub is in place before `mintPhoneOtp` dynamically imports
// the real module.

type SettingsStub = { metaTemplateApprovals: Record<string, unknown> } | null
let _settingsOverride: SettingsStub = {
  metaTemplateApprovals: { vobase_platform_otp: 'approved' },
}

mock.module('@modules/channels/service/notification-settings', () => ({
  getNotificationSettings: async (_db: unknown, _orgId: string) =>
    _settingsOverride === null
      ? null
      : {
          organizationId: 'stub',
          notificationEndpointId: 'ep-notif-stub',
          magicLinkEndpointId: 'ep-ml-stub',
          platformHmacSecretEnvelope: 'envelope-stub',
          platformBaseUrl: 'http://platform.test',
          displayPhoneNumber: '+15550001',
          phoneNumberId: 'pn-stub',
          wabaId: 'waba-stub',
          metaTemplateApprovals: _settingsOverride.metaTemplateApprovals,
          lastVerifyStatus: null,
          lastVerifiedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
}))

// ─── Per-test mock seam: global fetch ────────────────────────────────────────
// `mintPhoneOtp` POSTs to `<platformBaseUrl>/api/managed-whatsapp/otp` via
// `signedPlatformRequest`. We stub global fetch to capture the request shape
// and return a configurable response. The original fetch is restored in
// afterAll so the test runtime isn't polluted.

const realFetch = globalThis.fetch
type FetchImpl = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
let _fetchImpl: FetchImpl = async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []

const stubFetch: FetchImpl = async (url, init) => {
  fetchCalls.push({ url: String(url), init })
  return _fetchImpl(url, init)
}
// `typeof fetch` in Bun carries a `preconnect` method we don't need to stub.
// The test only exercises the call signature, so a structural cast is safe.
globalThis.fetch = stubFetch as unknown as typeof fetch

// Alice is seeded by contacts/seed.ts — userId is stable across resets.
const ALICE_USER_ID = 'usr0alice0'
const ALICE_PHONE = '+15555550001'
const TEST_ORG_ID = 'o1'

// Env required by the platform-relay path. Set once at file scope so every
// describe inherits the same baseline; tests that need to clear a value do so
// in their own beforeEach/afterEach.
process.env.VITE_PLATFORM_URL = 'http://localhost:65535'
process.env.PLATFORM_TENANT_ID = 'test-tenant'
process.env.PLATFORM_HMAC_SECRET = 'test-hmac-secret-32chars-min-len-pad'

describe('mintPhoneOtp', () => {
  const handle = connectTestDb()
  let auth: ReturnType<typeof createAuth>

  beforeAll(async () => {
    await resetAndSeedDb()
    auth = createAuth(handle.db as Parameters<typeof createAuth>[0])
  })

  afterAll(async () => {
    await handle.teardown()
    globalThis.fetch = realFetch
  })

  beforeEach(() => {
    fetchCalls.length = 0
    _fetchImpl = async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    _settingsOverride = {
      metaTemplateApprovals: { vobase_platform_otp: 'approved' },
    }
  })

  afterEach(() => {
    fetchCalls.length = 0
  })

  it('mints a 6-digit OTP, expires in 10 minutes, and POSTs to /api/managed-whatsapp/otp', async () => {
    const result = await mintPhoneOtp(auth, handle.db, {
      userId: ALICE_USER_ID,
      phoneNumber: ALICE_PHONE,
      organizationId: TEST_ORG_ID,
    })

    expect(result.code).toMatch(/^\d{6}$/u)
    // expiresAt should be ~10min from now
    const expiresAt = new Date(result.expiresAt).getTime()
    expect(expiresAt).toBeGreaterThan(Date.now() + 9 * 60 * 1000)
    expect(expiresAt).toBeLessThan(Date.now() + 11 * 60 * 1000)

    // Exactly one fetch hit /api/managed-whatsapp/otp with the expected body shape.
    const otpCalls = fetchCalls.filter((c) => c.url.endsWith('/api/managed-whatsapp/otp'))
    expect(otpCalls.length).toBe(1)
    const body = otpCalls[0]?.init?.body
    expect(typeof body).toBe('string')
    const parsed = JSON.parse(body as string)
    expect(parsed.staffPhoneE164).toBe(ALICE_PHONE)
    expect(parsed.code).toBe(result.code)
    expect(parsed.expiresInSec).toBe(600)

    // HMAC v2 signing headers present.
    const headers = otpCalls[0]?.init?.headers as Record<string, string> | undefined
    expect(headers?.['X-Tenant-Id']).toBe('test-tenant')
    expect(headers?.['X-Vobase-Sig-Version']).toBe('2')
    expect(typeof headers?.['X-Vobase-Routine-Sig']).toBe('string')
  })

  it('throws PhoneOtpMintError wrapping staff_user_not_found for a nonexistent user', async () => {
    try {
      await mintPhoneOtp(auth, handle.db, {
        userId: 'nonexistent-user-id',
        phoneNumber: '+15555559999',
        organizationId: TEST_ORG_ID,
      })
      throw new Error('mintPhoneOtp should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PhoneOtpMintError)
      const mintErr = err as PhoneOtpMintError
      expect(mintErr.message).toBe('phone_otp_mint_failed')
      const cause = mintErr.cause as { code?: string; message?: string } | undefined
      const innerText = JSON.stringify(cause ?? {}) + String(cause?.message ?? '')
      expect(innerText).toContain('staff_user_not_found')
    }
    // No platform fetch should have fired on the pre-flight failure path.
    expect(fetchCalls.filter((c) => c.url.endsWith('/api/managed-whatsapp/otp')).length).toBe(0)
  })

  it('throws phone_otp_template_unapproved when the template approval is missing', async () => {
    _settingsOverride = { metaTemplateApprovals: {} }
    try {
      await mintPhoneOtp(auth, handle.db, {
        userId: ALICE_USER_ID,
        phoneNumber: ALICE_PHONE,
        organizationId: TEST_ORG_ID,
      })
      throw new Error('mintPhoneOtp should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PhoneOtpMintError)
      expect((err as PhoneOtpMintError).message).toBe('phone_otp_template_unapproved')
    }
    // Captor was never invoked → no platform fetch.
    expect(fetchCalls.filter((c) => c.url.endsWith('/api/managed-whatsapp/otp')).length).toBe(0)
  })

  it('throws phone_otp_template_unapproved when notification settings are missing entirely', async () => {
    _settingsOverride = null
    try {
      await mintPhoneOtp(auth, handle.db, {
        userId: ALICE_USER_ID,
        phoneNumber: ALICE_PHONE,
        organizationId: TEST_ORG_ID,
      })
      throw new Error('mintPhoneOtp should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PhoneOtpMintError)
      expect((err as PhoneOtpMintError).message).toBe('phone_otp_template_unapproved')
    }
  })

  it('resolves 50 concurrent mints for the same phone to distinct codes', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        mintPhoneOtp(auth, handle.db, {
          userId: ALICE_USER_ID,
          phoneNumber: ALICE_PHONE,
          organizationId: TEST_ORG_ID,
        }),
      ),
    )
    // Each mint produces a fresh 6-digit code via better-auth's `generateOTP`.
    // 50 distinct codes from a 1M-space → birthday-paradox collision probability
    // is ~0.12%; the test relies on that being below the failure-tolerance
    // threshold for CI. If this ever flakes we can drop to 20 mints (~0.02%).
    const codes = new Set(results.map((r) => r.code))
    expect(codes.size).toBe(50)
  }, 30_000)
})

// ─── Captor timeout — isolated describe so the stubbed `auth` doesn't bleed ──
// Monkey-patches `auth.api.sendPhoneNumberOTP` to resolve without invoking
// the `sendOTP` callback. The captor's 5 s safety-net should reject with
// `captor_timeout` wrapped in `PhoneOtpMintError`.

describe('mintPhoneOtp captor timeout', () => {
  it('rejects with captor_timeout when sendPhoneNumberOTP never invokes sendOTP', async () => {
    const handle2 = connectTestDb()
    try {
      await resetAndSeedDb()
      const realAuth = createAuth(handle2.db as Parameters<typeof createAuth>[0])

      // Stub auth where sendPhoneNumberOTP resolves silently without invoking
      // sendOTP — this triggers the captor's 5 s timeout.
      const stubAuth = {
        ...realAuth,
        api: {
          ...realAuth.api,
          // biome-ignore lint/suspicious/noExplicitAny: stub for timeout test
          sendPhoneNumberOTP: async (_opts: unknown) => ({ message: 'code sent' }) as any,
        },
      } as unknown as typeof realAuth

      const startMs = Date.now()
      try {
        await mintPhoneOtp(stubAuth, handle2.db, {
          userId: ALICE_USER_ID,
          phoneNumber: ALICE_PHONE,
          organizationId: TEST_ORG_ID,
        })
        throw new Error('mintPhoneOtp should have rejected on captor timeout')
      } catch (err) {
        expect(err).toBeInstanceOf(PhoneOtpMintError)
        const mintErr = err as PhoneOtpMintError
        expect(mintErr.message).toBe('phone_otp_mint_failed')
        const causeMsg = (mintErr.cause as { message?: string } | undefined)?.message ?? String(mintErr.cause ?? '')
        expect(causeMsg).toContain('captor_timeout')
      }

      // Should reject within 5.5 s of CAPTOR_TIMEOUT_MS = 5_000.
      expect(Date.now() - startMs).toBeLessThan(5_500)
    } finally {
      await handle2.teardown()
    }
  }, 10_000)
})
