/**
 * Integration: WhatsApp-OTP login from the auth page (signed-out → signed-in).
 *
 * Exercises the `authClient.phoneNumber.sendOtp` → `authClient.phoneNumber.verify`
 * flow that the login page wires up. The two endpoints are mounted on a real
 * better-auth handler over a real Postgres DB; the platform relay
 * (`/api/whatsapp/otp`) is stubbed via a global fetch monkey-patch so we can
 * assert the relay was hit with the captor-minted code.
 *
 * Coverage:
 *   1. Existing staff user with `phoneNumberVerified=true` → sendOtp triggers a
 *      platform relay; verify creates a session keyed on that user.
 *   2. Unknown phone → sendOtp does NOT relay (no user → plugin never invokes
 *      `sendOTP` callback only after creating a verification value; but verify
 *      then fails because there is no user to update). We assert no session
 *      cookie is issued and verify returns an error.
 *   3. Existing user with `phoneNumberVerified=false` → sendOtp + verify still
 *      succeeds at the plugin level (it flips `phoneNumberVerified` to true and
 *      signs the user in). The product invariant in the login flow lives in
 *      step (1) — we keep an explicit assertion here that the seed precondition
 *      doesn't block plugin-level signin so future code that adds a guard has
 *      a regression hook.
 *
 * Why a real Postgres: the verifyPhoneNumber endpoint reads + updates
 * `auth.user.phoneNumberVerified` through the Drizzle adapter; stubbing that
 * would lose the column-mapping behavior we depend on.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createNanoid } from '@vobase/core'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { createAuth } from '../../auth/index'
import { mintPhoneOtp } from '../../auth/phone-otp'
import { authOrganization, authUser } from '../../auth/schema'
import { connectTestDb, resetAndSeedDb } from '../helpers/test-db'

// ─── Channel approval stub (needed by mintPhoneOtp transitively) ─────────────
// The direct-client `deliverPhoneOtp` path does NOT touch
// `findNotificationChannel` (no template-approval gate on the login path —
// the gate lives inside `mintPhoneOtp`), but `auth/phone-otp.ts` still
// imports `@modules/channels/service/instances` dynamically inside
// `mintPhoneOtp`. Stubbing here keeps the module graph happy if any code
// path lazy-loads it.

mock.module('@modules/channels/service/instances', () => ({
  findNotificationChannel: async (_orgId: string) => ({
    config: { metaTemplateApprovals: { vobase_platform_otp: 'approved' } },
  }),
}))

// ─── Global fetch stub for the platform OTP relay ────────────────────────────

const realFetch = globalThis.fetch
type FetchImpl = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []

// biome-ignore lint/suspicious/useAwait: fetch contract requires async signature
const stubFetch: FetchImpl = async (url, init) => {
  fetchCalls.push({ url: String(url), init })
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
globalThis.fetch = stubFetch as unknown as typeof fetch

// ─── Platform env (required by the deliverPhoneOtp direct-send path) ─────────

process.env.VITE_PLATFORM_URL = 'http://localhost:65535'
process.env.PLATFORM_TENANT_ID = 'test-tenant'
process.env.PLATFORM_HMAC_SECRET = 'test-hmac-secret-32chars-min-len-pad'

// ─── App factory ─────────────────────────────────────────────────────────────

function buildAuthApp(auth: ReturnType<typeof createAuth>): Hono {
  const app = new Hono()
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))
  return app
}

/** Extract the freshly-minted OTP from the captured platform-relay POST body. */
function extractOtpFromRelay(): string {
  const otpCalls = fetchCalls.filter((c) => c.url.endsWith('/api/whatsapp/otp'))
  expect(otpCalls.length).toBe(1)
  const body = otpCalls[0]?.init?.body
  expect(typeof body).toBe('string')
  const parsed = JSON.parse(body as string) as { staffPhoneE164: string; code: string }
  expect(parsed.code).toMatch(/^\d{6}$/u)
  return parsed.code
}

// ─── Shared setup ────────────────────────────────────────────────────────────

const handle = connectTestDb()
let auth: ReturnType<typeof createAuth>
let app: Hono
let orgAId: string

beforeAll(async () => {
  await resetAndSeedDb()
  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  auth = createAuth(handle.db as any)
  app = buildAuthApp(auth)

  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  const db = handle.db as any
  const [firstOrg] = await db.select({ id: authOrganization.id }).from(authOrganization).limit(1)
  orgAId = firstOrg.id
})

afterAll(async () => {
  await handle.teardown()
  globalThis.fetch = realFetch
})

beforeEach(() => {
  fetchCalls.length = 0
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function seedUserWithPhone(args: {
  phoneNumber: string
  phoneNumberVerified: boolean | null
  name?: string
}): Promise<string> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  const db = handle.db as any
  const nano = createNanoid()
  const userId = nano()
  await db.insert(authUser).values({
    id: userId,
    name: args.name ?? `User-${userId.slice(0, 6)}`,
    email: `${userId}@test.local`,
    emailVerified: true,
    phoneNumber: args.phoneNumber,
    phoneNumberVerified: args.phoneNumberVerified,
  })
  return userId
}

function postJson(path: string, body: Record<string, unknown>): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),
  )
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WhatsApp-OTP login (signed-out → signed-in)', () => {
  it('signs in existing staff user with verified phone via sendOtp + verify', async () => {
    const phoneNumber = '+15551110001'
    const userId = await seedUserWithPhone({ phoneNumber, phoneNumberVerified: true, name: 'Verified Vera' })

    // 1) Client triggers OTP send — should relay one POST to the platform.
    const sendRes = await postJson('/api/auth/phone-number/send-otp', { phoneNumber })
    expect(sendRes.status).toBe(200)
    const code = extractOtpFromRelay()

    // 2) Client verifies — better-auth's verifyPhoneNumber updates
    //    phoneNumberVerified=true (already true) and creates a session.
    const verifyRes = await postJson('/api/auth/phone-number/verify', { phoneNumber, code })
    expect(verifyRes.status).toBe(200)
    const verifyBody = (await verifyRes.json()) as { status?: boolean; user?: { id?: string }; token?: string | null }
    expect(verifyBody.status).toBe(true)
    expect(verifyBody.user?.id).toBe(userId)
    // A session cookie should have been set on the response.
    const setCookie = verifyRes.headers.get('set-cookie') ?? ''
    expect(setCookie.length).toBeGreaterThan(0)
  })

  it('does NOT sign in for an unknown phone number', async () => {
    const phoneNumber = '+15559990000' // no user with this number
    // sendOtp still succeeds — the plugin issues the OTP regardless of user
    // existence (otherwise it would leak phone-number presence). We intentionally
    // do NOT enable `signUpOnVerification` in plugins.ts so the verify step
    // throws when the user does not exist.
    const sendRes = await postJson('/api/auth/phone-number/send-otp', { phoneNumber })
    expect(sendRes.status).toBe(200)
    const code = extractOtpFromRelay()

    const verifyRes = await postJson('/api/auth/phone-number/verify', { phoneNumber, code })
    // No user → updateUser fails with FAILED_TO_UPDATE_USER (500).
    expect(verifyRes.status).not.toBe(200)
    expect(verifyRes.headers.get('set-cookie')).toBeFalsy()
  })

  it('verifies a previously-unverified user and flips phoneNumberVerified=true', async () => {
    const phoneNumber = '+15552220002'
    const userId = await seedUserWithPhone({
      phoneNumber,
      phoneNumberVerified: false,
      name: 'Pending Pat',
    })

    const sendRes = await postJson('/api/auth/phone-number/send-otp', { phoneNumber })
    expect(sendRes.status).toBe(200)
    const code = extractOtpFromRelay()

    const verifyRes = await postJson('/api/auth/phone-number/verify', { phoneNumber, code })
    expect(verifyRes.status).toBe(200)

    // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
    const db = handle.db as any
    const [updated] = await db
      .select({ phoneNumberVerified: authUser.phoneNumberVerified })
      .from(authUser)
      .where(eq(authUser.id, userId))
      .limit(1)
    expect(updated?.phoneNumberVerified).toBe(true)
  })

  it('relays through the existing captor-based mintPhoneOtp flow (admin self-verify preserved)', async () => {
    // Regression guard: invoking mintPhoneOtp still wires through the captor
    // and produces a code (i.e. our deliverPhoneOtp refactor didn't break the
    // nonce-bearing path that the staff-phone change flow depends on).
    // Use a fresh seeded user so the captor and direct-send branches don't share rows.
    const phoneNumber = '+15553330003'
    const userId = await seedUserWithPhone({ phoneNumber, phoneNumberVerified: null, name: 'Captor Carl' })

    const result = await mintPhoneOtp(auth, handle.db, { userId, phoneNumber, organizationId: orgAId })
    expect(result.code).toMatch(/^\d{6}$/u)
    expect(fetchCalls.some((c) => c.url.endsWith('/api/whatsapp/otp'))).toBe(true)
  })
})
