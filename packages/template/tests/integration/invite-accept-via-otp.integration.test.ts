/**
 * Integration test for the invite-accept-via-OTP flow.
 *
 * Reproduces the production bug where a pending invitation was silently dropped
 * when the invited user signed in via the email-OTP flow:
 *
 *   1. Admin invites carol@example.com into Org B → `auth.invitation` row pending.
 *   2. Carol clicks the email link → /auth/login?invitationId=<id>.
 *   3. Carol enters her email + OTP code.
 *   4. better-auth creates `auth.user` for Carol → fires `databaseHooks.user.create.after`
 *      → `autoEnroll(user)`.
 *
 * Before the fix, autoEnroll() short-circuited on ANY existing membership (e.g. the
 * bootstrap Workspace org seeded for the first signup), so the pending invite was
 * never processed.
 *
 * We exercise the autoEnroll path by inserting the user via the same hook pathway:
 * calling `auth.databaseHooks.user.create.after({ id, email })` is brittle (private
 * field), so we invoke autoEnroll's effects by inserting the user row and triggering
 * the session.create.before hook via a dev-login call — that hook ALSO runs
 * autoEnroll for pre-existing users.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createNanoid } from '@vobase/core'
import { and, eq } from 'drizzle-orm'

import { createAuth } from '../../auth/index'
import { authInvitation, authMember, authOrganization, authUser } from '../../auth/schema'
import { staffProfiles } from '../../modules/team/schema'
import { connectTestDb, resetAndSeedDb } from '../helpers/test-db'

const nano = createNanoid()
const handle = connectTestDb()
let auth: ReturnType<typeof createAuth>

beforeAll(async () => {
  await resetAndSeedDb()
  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  auth = createAuth(handle.db as any)
}, 60_000)

afterAll(async () => {
  await handle.teardown()
})

interface SeededInvite {
  organizationId: string
  email: string
  invitationId: string
}

async function seedOrgAndInvite(emailOverride?: string): Promise<SeededInvite> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  const dbAny = handle.db as any
  const organizationId = nano()
  const inviterId = nano()
  const email = emailOverride ?? `invitee-${nano()}@meridian.test`
  await dbAny.insert(authOrganization).values({
    id: organizationId,
    name: `Org-${organizationId.slice(0, 6)}`,
    slug: `org-${organizationId.slice(0, 8)}`,
    createdAt: new Date(),
  })
  await dbAny.insert(authUser).values({
    id: inviterId,
    name: `Inviter-${inviterId.slice(0, 4)}`,
    email: `inviter-${inviterId}@meridian.test`,
    emailVerified: true,
  })
  const invitationId = nano()
  await dbAny.insert(authInvitation).values({
    id: invitationId,
    organizationId,
    email,
    role: 'member',
    status: 'pending',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    inviterId,
  })
  return { organizationId, email, invitationId }
}

/**
 * Trigger autoEnroll by signing the user in via dev-login. dev-login creates
 * the user if missing and opens a session, which fires both `user.create.after`
 * and `session.create.before` — both run autoEnroll, so the invite gets processed.
 */
async function signInViaDevLogin(email: string): Promise<void> {
  const res = await auth.handler(
    new Request('http://localhost/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
  )
  if (res.status !== 200) {
    throw new Error(`dev-login failed ${res.status}: ${await res.text()}`)
  }
}

describe('invite-accept via OTP signin', () => {
  it('creates member row from pending invite regardless of any existing membership (bootstrap org)', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
    const dbAny = handle.db as any
    const invite = await seedOrgAndInvite()

    await signInViaDevLogin(invite.email)

    // The newly-created user must now be a member of the invite's org.
    const [user] = await dbAny
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.email, invite.email))
      .limit(1)
    expect(user?.id).toBeDefined()

    const memberRows = await dbAny
      .select({ organizationId: authMember.organizationId })
      .from(authMember)
      .where(eq(authMember.userId, user.id))
    const orgIds = memberRows.map((r: { organizationId: string }) => r.organizationId)
    expect(orgIds).toContain(invite.organizationId)

    // autoEnroll deliberately leaves invitation 'pending' so the SPA's
    // explicit acceptInvitation call can drive better-auth's accept endpoint
    // (which marks it 'accepted' and triggers the invite-redirect middleware).
    const [inv] = await dbAny
      .select({ status: authInvitation.status })
      .from(authInvitation)
      .where(eq(authInvitation.id, invite.invitationId))
      .limit(1)
    expect(inv?.status).toBe('pending')

    const [profile] = await dbAny
      .select({ userId: staffProfiles.userId })
      .from(staffProfiles)
      .where(and(eq(staffProfiles.userId, user.id), eq(staffProfiles.organizationId, invite.organizationId)))
      .limit(1)
    expect(profile?.userId).toBe(user.id)
  })

  it('case-insensitive email match: invite emailed as Mixed.Case is found when user signs in lowercase', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
    const dbAny = handle.db as any
    const mixedEmail = `MixedCase-${nano()}@Meridian.TEST`
    const invite = await seedOrgAndInvite(mixedEmail)

    // better-auth normalizes the user.email to lowercase on creation, so the
    // invite lookup must compare case-insensitively.
    await signInViaDevLogin(mixedEmail.toLowerCase())

    const [user] = await dbAny
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.email, mixedEmail.toLowerCase()))
      .limit(1)
    expect(user?.id).toBeDefined()

    const [member] = await dbAny
      .select({ userId: authMember.userId })
      .from(authMember)
      .where(and(eq(authMember.userId, user.id), eq(authMember.organizationId, invite.organizationId)))
      .limit(1)
    expect(member?.userId).toBe(user.id)

    // Invitation stays 'pending' — only the explicit acceptInvitation call marks it 'accepted'.
    const [inv] = await dbAny
      .select({ status: authInvitation.status })
      .from(authInvitation)
      .where(eq(authInvitation.id, invite.invitationId))
      .limit(1)
    expect(inv?.status).toBe('pending')
  })

  it('multi-org: pre-existing member in OrgA still joins OrgB on a fresh invite', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
    const dbAny = handle.db as any
    const orgAId = nano()
    const userId = nano()
    const email = `multi-${nano()}@meridian.test`

    // Seed an existing user with membership in OrgA.
    await dbAny.insert(authOrganization).values({
      id: orgAId,
      name: `OrgA-${orgAId.slice(0, 6)}`,
      slug: `org-a-${orgAId.slice(0, 8)}`,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    })
    await dbAny.insert(authUser).values({
      id: userId,
      name: 'Multi Existing',
      email,
      emailVerified: true,
    })
    await dbAny.insert(authMember).values({
      id: nano(),
      organizationId: orgAId,
      userId,
      role: 'member',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    })

    // Now seed a fresh invitation into OrgB for the same email.
    const invite = await seedOrgAndInvite(email)

    // Sign the user in — session.create.before fires autoEnroll on the
    // pre-existing user and must create the OrgB member row even though they
    // already have an OrgA membership.
    await signInViaDevLogin(email)

    const memberRows = await dbAny
      .select({ organizationId: authMember.organizationId })
      .from(authMember)
      .where(eq(authMember.userId, userId))
    const orgIds = memberRows.map((r: { organizationId: string }) => r.organizationId)
    expect(orgIds).toContain(orgAId)
    expect(orgIds).toContain(invite.organizationId)

    // Invitation stays 'pending' — only the explicit acceptInvitation call marks it 'accepted'.
    const [inv] = await dbAny
      .select({ status: authInvitation.status })
      .from(authInvitation)
      .where(eq(authInvitation.id, invite.invitationId))
      .limit(1)
    expect(inv?.status).toBe('pending')
  })
})
