/**
 * Integration: admin phone change fires a verification OTP.
 *
 * Creates a real staff user + profile, stubs `mintPhoneOtp` via mock.module,
 * then calls `createStaffService({ auth }).update(...)` with a new phoneNumber
 * and asserts the captor was invoked. Uses a real Postgres DB — the phone
 * write goes through the actual Drizzle adapter.
 */

import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { createNanoid } from '@vobase/core'

import { authOrganization, authUser } from '../../auth/schema'
import { staffProfiles } from '../../modules/team/schema'
import { createStaffService } from '../../modules/team/service/staff'
import { connectTestDb, resetAndSeedDb } from '../helpers/test-db'

const NOOP_REALTIME = { notify: () => {}, subscribe: () => () => {} }

// ─── Stub mintPhoneOtp ────────────────────────────────────────────────────────

const mintCalls: Array<{ userId: string; phoneNumber: string; organizationId: string }> = []

mock.module('@auth/phone-otp', () => ({
  // biome-ignore lint/suspicious/useAwait: stub returns synchronously but must match async contract
  mintPhoneOtp: async (
    _auth: unknown,
    _db: unknown,
    input: { userId: string; phoneNumber: string; organizationId: string },
  ) => {
    mintCalls.push(input)
    return { code: '123456', expiresAt: new Date(Date.now() + 600_000).toISOString() }
  },
  PhoneOtpMintError: class PhoneOtpMintError extends Error {
    override name = 'PhoneOtpMintError'
    cause: unknown
    constructor(message: string, options?: { cause?: unknown }) {
      super(message)
      this.cause = options?.cause
    }
  },
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function noopAuth() {
  // Minimal shape — only used as the `auth` pass-through in mintPhoneOtp stub.
  return {} as Parameters<typeof createStaffService>[0]['auth']
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const handle = connectTestDb()

beforeAll(async () => {
  await resetAndSeedDb()
})

afterAll(async () => {
  await handle.teardown()
})

describe('staff phone change triggers OTP (US self-verify)', () => {
  it('calls mintPhoneOtp when admin sets a new phone number', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
    const dbAny = handle.db as any
    const nano = createNanoid()

    const orgId = nano()
    const userId = nano()

    await dbAny.insert(authOrganization).values({
      id: orgId,
      name: `Org-${orgId.slice(0, 6)}`,
      slug: `org-${orgId.slice(0, 8)}`,
      createdAt: new Date(),
    })
    await dbAny.insert(authUser).values({
      id: userId,
      name: 'Bob Test',
      email: `bob-${userId}@test.local`,
      emailVerified: true,
      phoneNumberVerified: null,
    })
    await dbAny.insert(staffProfiles).values({ userId, organizationId: orgId, displayName: 'Bob Test' })

    mintCalls.length = 0

    const svc = createStaffService({ db: handle.db, realtime: NOOP_REALTIME, auth: noopAuth() })
    await svc.update(userId, { phoneNumber: '+6591234567' })

    // Give the fire-and-forget void chain a tick to settle.
    await new Promise((r) => setTimeout(r, 50))

    expect(mintCalls).toHaveLength(1)
    expect(mintCalls[0]?.userId).toBe(userId)
    expect(mintCalls[0]?.phoneNumber).toBe('+6591234567')
    expect(mintCalls[0]?.organizationId).toBe(orgId)
  })

  it('does NOT call mintPhoneOtp when phone is cleared (null)', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
    const dbAny = handle.db as any
    const nano = createNanoid()

    const orgId = nano()
    const userId = nano()

    await dbAny.insert(authOrganization).values({
      id: orgId,
      name: `Org-${orgId.slice(0, 6)}`,
      slug: `org-${orgId.slice(0, 8)}`,
      createdAt: new Date(),
    })
    await dbAny.insert(authUser).values({
      id: userId,
      name: 'Clara Test',
      email: `clara-${userId}@test.local`,
      emailVerified: true,
      phoneNumber: '+6598765432',
      phoneNumberVerified: true,
    })
    await dbAny.insert(staffProfiles).values({ userId, organizationId: orgId, displayName: 'Clara Test' })

    mintCalls.length = 0

    const svc = createStaffService({ db: handle.db, realtime: NOOP_REALTIME, auth: noopAuth() })
    await svc.update(userId, { phoneNumber: null })

    await new Promise((r) => setTimeout(r, 50))

    expect(mintCalls).toHaveLength(0)
  })

  it('does NOT call mintPhoneOtp when no auth handle is provided', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
    const dbAny = handle.db as any
    const nano = createNanoid()

    const orgId = nano()
    const userId = nano()

    await dbAny.insert(authOrganization).values({
      id: orgId,
      name: `Org-${orgId.slice(0, 6)}`,
      slug: `org-${orgId.slice(0, 8)}`,
      createdAt: new Date(),
    })
    await dbAny.insert(authUser).values({
      id: userId,
      name: 'Dan Test',
      email: `dan-${userId}@test.local`,
      emailVerified: true,
      phoneNumberVerified: null,
    })
    await dbAny.insert(staffProfiles).values({ userId, organizationId: orgId, displayName: 'Dan Test' })

    mintCalls.length = 0

    // No auth — legacy path used by test stubs.
    const svc = createStaffService({ db: handle.db, realtime: NOOP_REALTIME })
    await svc.update(userId, { phoneNumber: '+6511112222' })

    await new Promise((r) => setTimeout(r, 50))

    expect(mintCalls).toHaveLength(0)
  })
})
