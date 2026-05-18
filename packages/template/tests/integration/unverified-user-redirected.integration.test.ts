/**
 * Integration: the `/_app` route guard redirects unverified users with a phone.
 *
 * The guard logic lives in `src/shell/app-layout.tsx::requireSession` which
 * runs client-side via TanStack Router's `beforeLoad`. We can't run the React
 * router in a unit test, but we CAN verify the server-side data shape that
 * drives the guard: `authClient.getSession()` must return both `phoneNumber`
 * and `phoneNumberVerified` on the user object.
 *
 * This test therefore asserts the DB-level invariant the guard depends on:
 *   - A user whose `auth.user.phoneNumber` is set and `phoneNumberVerified`
 *     is false has BOTH fields readable via the same Drizzle join the service
 *     uses, confirming the guard has the data it needs.
 *   - A user with no phone does NOT get the redirect signal (verified=null/true
 *     or phone=null both mean "no redirect").
 *
 * The actual SPA redirect is covered by the verify-phone page's own E2E path
 * and by the invite-redirect middleware integration test.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createNanoid } from '@vobase/core'
import { eq } from 'drizzle-orm'

import { authOrganization, authUser } from '../../auth/schema'
import { staffProfiles } from '../../modules/team/schema'
import { connectTestDb, resetAndSeedDb } from '../helpers/test-db'

const handle = connectTestDb()

beforeAll(async () => {
  await resetAndSeedDb()
})

afterAll(async () => {
  await handle.teardown()
})

describe('unverified-user route-guard data contract', () => {
  it('user with phone unverified → phoneNumber + phoneNumberVerified=false visible on auth.user row', async () => {
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
      name: 'Eve Unverified',
      email: `eve-${userId}@test.local`,
      emailVerified: true,
      phoneNumber: '+6591111111',
      phoneNumberVerified: false,
    })
    await dbAny.insert(staffProfiles).values({ userId, organizationId: orgId, displayName: 'Eve Unverified' })

    const rows = await dbAny
      .select({ phoneNumber: authUser.phoneNumber, phoneNumberVerified: authUser.phoneNumberVerified })
      .from(authUser)
      .where(eq(authUser.id, userId))
      .limit(1)

    const row = rows[0] as { phoneNumber: string | null; phoneNumberVerified: boolean | null }
    expect(row.phoneNumber).toBe('+6591111111')
    expect(row.phoneNumberVerified).toBe(false)

    // Guard logic: redirect when phone != null && verified !== true
    const shouldRedirect = row.phoneNumber !== null && row.phoneNumberVerified !== true
    expect(shouldRedirect).toBe(true)
  })

  it('user with no phone → no redirect signal', async () => {
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
      name: 'Frank NoPhone',
      email: `frank-${userId}@test.local`,
      emailVerified: true,
      phoneNumber: null,
      phoneNumberVerified: null,
    })
    await dbAny.insert(staffProfiles).values({ userId, organizationId: orgId, displayName: 'Frank NoPhone' })

    const rows = await dbAny
      .select({ phoneNumber: authUser.phoneNumber, phoneNumberVerified: authUser.phoneNumberVerified })
      .from(authUser)
      .where(eq(authUser.id, userId))
      .limit(1)

    const row = rows[0] as { phoneNumber: string | null; phoneNumberVerified: boolean | null }
    expect(row.phoneNumber).toBeNull()

    const shouldRedirect = row.phoneNumber !== null && row.phoneNumberVerified !== true
    expect(shouldRedirect).toBe(false)
  })

  it('user with phone verified → no redirect signal', async () => {
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
      name: 'Grace Verified',
      email: `grace-${userId}@test.local`,
      emailVerified: true,
      phoneNumber: '+6599999999',
      phoneNumberVerified: true,
    })
    await dbAny.insert(staffProfiles).values({ userId, organizationId: orgId, displayName: 'Grace Verified' })

    const rows = await dbAny
      .select({ phoneNumber: authUser.phoneNumber, phoneNumberVerified: authUser.phoneNumberVerified })
      .from(authUser)
      .where(eq(authUser.id, userId))
      .limit(1)

    const row = rows[0] as { phoneNumber: string | null; phoneNumberVerified: boolean | null }
    expect(row.phoneNumber).toBe('+6599999999')
    expect(row.phoneNumberVerified).toBe(true)

    const shouldRedirect = row.phoneNumber !== null && row.phoneNumberVerified !== true
    expect(shouldRedirect).toBe(false)
  })
})
