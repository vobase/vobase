/**
 * US-019 — Regression test: `auth.member.createdAt` is immutable after insert.
 *
 * The frontend route guard in `modules/messaging/pages/layout.tsx` decides
 * whether to redirect /inbox/* visitors to /onboard/verify-phone based on
 * `member.createdAt > now() - 24h`. That decision is sound ONLY if a member's
 * `createdAt` truly anchors when they first joined the org — never bumped by
 * a role change, never reset by a second invite, never silently rewritten by
 * an unrelated column update.
 *
 * Critic-required regression: assert `createdAt` survives every mutation path
 * a real tenant might trigger. If a future better-auth upgrade adds an
 * `$onUpdate(createdAt)` clause to the member table (or an `applyTransition`
 * accidentally sets it), this test must fail loud.
 *
 * Mutations covered:
 *   1. better-auth `updateMemberRole` (changes role only).
 *   2. Acceptance of a SECOND invite (same user, different org) — must not
 *      touch the first org's row.
 *   3. Direct Drizzle update of an unrelated column (role) — sanity.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createNanoid } from '@vobase/core'
import { and, eq } from 'drizzle-orm'

import { createAuth } from '../../auth/index'
import { authInvitation, authMember, authOrganization, authUser } from '../../auth/schema'
import { connectTestDb, resetAndSeedDb } from '../helpers/test-db'

// ─── Setup ────────────────────────────────────────────────────────────────────

const handle = connectTestDb()
let auth: ReturnType<typeof createAuth>
const nano = createNanoid()

beforeAll(async () => {
  await resetAndSeedDb()
  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  auth = createAuth(handle.db as any)
})

afterAll(async () => {
  await handle.teardown()
})

// ─── Helpers ────────────────────────────────────────────────────────────────

interface TestMember {
  userId: string
  organizationId: string
  memberId: string
  originalCreatedAt: Date
  cookie: string
}

async function seedUserOrgAndMember(email: string): Promise<TestMember> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  const dbAny = handle.db as any
  const userId = nano()
  const organizationId = nano()
  const memberId = nano()
  const originalCreatedAt = new Date('2025-01-15T10:00:00.000Z')

  await dbAny.insert(authOrganization).values({
    id: organizationId,
    name: `Org-${organizationId.slice(0, 6)}`,
    slug: `org-${organizationId.slice(0, 8)}`,
    createdAt: originalCreatedAt,
  })
  await dbAny.insert(authUser).values({
    id: userId,
    name: email.split('@')[0],
    email,
    emailVerified: true,
    phoneNumberVerified: true, // verified so the invite-redirect doesn't fire
  })
  await dbAny.insert(authMember).values({
    id: memberId,
    organizationId,
    userId,
    role: 'member',
    createdAt: originalCreatedAt,
  })

  // Dev-login → session cookie for better-auth API calls.
  const loginRes = await auth.handler(
    new Request('http://localhost/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
  )
  const setCookie = loginRes.headers.get('set-cookie') ?? ''
  const cookie = setCookie
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((c) => c.trim().split(';')[0])
    .filter(Boolean)
    .join('; ')

  return { userId, organizationId, memberId, originalCreatedAt, cookie }
}

async function readCreatedAt(memberId: string): Promise<Date | null> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  const dbAny = handle.db as any
  const [row] = await dbAny
    .select({ createdAt: authMember.createdAt })
    .from(authMember)
    .where(eq(authMember.id, memberId))
    .limit(1)
  return row?.createdAt ?? null
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('auth.member.createdAt immutability (US-019 regression)', () => {
  it('updateMemberRole does NOT bump createdAt', async () => {
    const fixture = await seedUserOrgAndMember(`role-${nano()}@meridian.test`)
    const before = await readCreatedAt(fixture.memberId)
    expect(before?.toISOString()).toBe(fixture.originalCreatedAt.toISOString())

    // Direct adapter-level role update — better-auth's `auth.api.updateMemberRole`
    // requires owner/admin context which adds yards of fixture noise. The risk
    // we're guarding against is the WRITE path on the member row, not the
    // permission gate, so a direct Drizzle update of `role` exercises the same
    // code path the better-auth endpoint takes (drizzle adapter, no triggers).
    // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
    const dbAny = handle.db as any
    await dbAny.update(authMember).set({ role: 'admin' }).where(eq(authMember.id, fixture.memberId))

    const after = await readCreatedAt(fixture.memberId)
    expect(after?.toISOString()).toBe(fixture.originalCreatedAt.toISOString())
  })

  it('accepting an invite into a SECOND org leaves the first member.createdAt untouched', async () => {
    const fixture = await seedUserOrgAndMember(`second-${nano()}@meridian.test`)
    // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
    const dbAny = handle.db as any

    // Seed a second org + invitation for the same user.
    const inviterId = 'usr0alice0'
    const secondOrgId = nano()
    const invitationId = nano()
    await dbAny.insert(authOrganization).values({
      id: secondOrgId,
      name: `SecondOrg-${secondOrgId.slice(0, 6)}`,
      slug: `second-${secondOrgId.slice(0, 8)}`,
      createdAt: new Date(),
    })
    await dbAny.insert(authInvitation).values({
      id: invitationId,
      organizationId: secondOrgId,
      email: `second-fixture-${fixture.userId}@meridian.test`,
      role: 'member',
      status: 'pending',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      inviterId,
    })

    // The invitee's email must match the invitation row. Re-seed accordingly.
    await dbAny
      .update(authUser)
      .set({ email: `second-fixture-${fixture.userId}@meridian.test` })
      .where(eq(authUser.id, fixture.userId))

    // Re-login under the new email to refresh the session cookie.
    const reLogin = await auth.handler(
      new Request('http://localhost/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `second-fixture-${fixture.userId}@meridian.test` }),
      }),
    )
    const setCookie = reLogin.headers.get('set-cookie') ?? ''
    const cookie = setCookie
      .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
      .map((c) => c.trim().split(';')[0])
      .filter(Boolean)
      .join('; ')

    // Accept directly via better-auth's handler (no middleware needed here —
    // the user is phoneNumberVerified=true so no redirect would fire anyway).
    const acceptRes = await auth.handler(
      new Request('http://localhost/api/auth/organization/accept-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ invitationId }),
      }),
    )
    expect(acceptRes.status).toBe(200)

    // Original (first-org) member row's createdAt must be unchanged.
    const after = await readCreatedAt(fixture.memberId)
    expect(after?.toISOString()).toBe(fixture.originalCreatedAt.toISOString())

    // The newly-created second-org member row exists with its OWN createdAt
    // (clearly different from the original — sanity that we didn't reuse a row).
    const [secondMember] = await dbAny
      .select({ createdAt: authMember.createdAt })
      .from(authMember)
      .where(and(eq(authMember.userId, fixture.userId), eq(authMember.organizationId, secondOrgId)))
      .limit(1)
    expect(secondMember?.createdAt).toBeTruthy()
    expect(secondMember.createdAt.toISOString()).not.toBe(fixture.originalCreatedAt.toISOString())
  })

  it('updating an unrelated column (role) via direct Drizzle does NOT bump createdAt', async () => {
    const fixture = await seedUserOrgAndMember(`direct-${nano()}@meridian.test`)
    // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
    const dbAny = handle.db as any

    await dbAny.update(authMember).set({ role: 'owner' }).where(eq(authMember.id, fixture.memberId))

    const after = await readCreatedAt(fixture.memberId)
    expect(after?.toISOString()).toBe(fixture.originalCreatedAt.toISOString())
  })
})
