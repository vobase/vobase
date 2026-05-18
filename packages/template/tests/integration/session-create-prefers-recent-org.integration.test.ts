/**
 * Integration test: when a user has membership in multiple orgs, the
 * `session.create.before` hook seeds `activeOrganizationId` with the
 * MOST-RECENTLY-CREATED membership.
 *
 * Regression guard for the bug where a user who just accepted an invite into
 * OrgB would still land in OrgA's inbox after sign-in because the hook took
 * `LIMIT 1` without an explicit `ORDER BY desc(createdAt)`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createNanoid } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { createAuth } from '../../auth/index'
import { authMember, authOrganization, authSession, authUser } from '../../auth/schema'
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

describe('session.create.before picks the most-recent membership', () => {
  it('seeds activeOrganizationId from the newest membership when user is in multiple orgs', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
    const dbAny = handle.db as any
    const userId = nano()
    const email = `multi-recent-${nano()}@meridian.test`
    const orgAId = nano()
    const orgBId = nano()

    // OrgA — older.
    await dbAny.insert(authOrganization).values({
      id: orgAId,
      name: `OrgA-${orgAId.slice(0, 6)}`,
      slug: `org-a-${orgAId.slice(0, 8)}`,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    })
    // OrgB — newer.
    await dbAny.insert(authOrganization).values({
      id: orgBId,
      name: `OrgB-${orgBId.slice(0, 6)}`,
      slug: `org-b-${orgBId.slice(0, 8)}`,
      createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    })
    await dbAny.insert(authUser).values({
      id: userId,
      name: 'Multi Recent',
      email,
      emailVerified: true,
    })
    // Membership in OrgA — older.
    await dbAny.insert(authMember).values({
      id: nano(),
      organizationId: orgAId,
      userId,
      role: 'member',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    })
    // Membership in OrgB — newer (just accepted invite).
    await dbAny.insert(authMember).values({
      id: nano(),
      organizationId: orgBId,
      userId,
      role: 'member',
      createdAt: new Date(Date.now() - 1 * 60 * 1000),
    })

    // Sign in (dev-login). session.create.before runs and must select OrgB.
    const res = await auth.handler(
      new Request('http://localhost/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    )
    expect(res.status).toBe(200)

    // Re-read the freshest session row for this user.
    const sessions = (await dbAny
      .select({ activeOrganizationId: authSession.activeOrganizationId, createdAt: authSession.createdAt })
      .from(authSession)
      .where(eq(authSession.userId, userId))) as Array<{
      activeOrganizationId: string | null
      createdAt: Date
    }>
    expect(sessions.length).toBeGreaterThan(0)
    // Sort by createdAt desc — take the newest.
    sessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    expect(sessions[0]?.activeOrganizationId).toBe(orgBId)
  })
})
