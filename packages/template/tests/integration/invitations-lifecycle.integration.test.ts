/**
 * Integration test for the pending-invitations lifecycle.
 *
 * Walks the service through invite → list → resend → revoke → re-invite,
 * asserting the row's `status`, `expiresAt`, and the realtime notify
 * call-sites that the team-roster UI relies on.
 *
 * Why integration (real Postgres): the service runs Drizzle queries against
 * the better-auth `auth.invitation` table — the joins (inviter user lookup,
 * org name lookup) only make sense against the real schema + indexes.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createNanoid } from '@vobase/core'
import { and, eq } from 'drizzle-orm'

import { authInvitation, authOrganization, authUser } from '../../auth/schema'
import {
  __resetInvitationsServiceForTests,
  createInvitationsService,
  installInvitationsService,
  listPending,
  resendInvitation,
  revokeInvitation,
} from '../../modules/team/service/invitations'
import { connectTestDb, resetAndSeedDb } from '../helpers/test-db'

const nano = createNanoid()

const handle = connectTestDb()

interface CapturedNotify {
  table: string
  id?: string
  action?: string
}
const capturedNotifies: CapturedNotify[] = []

beforeAll(async () => {
  await resetAndSeedDb()
  installInvitationsService(
    createInvitationsService({
      db: handle.db,
      realtime: {
        subscribe: () => () => {},
        notify: (payload) => {
          capturedNotifies.push({ table: payload.table, id: payload.id, action: payload.action })
        },
      },
    }),
  )
})

afterAll(async () => {
  __resetInvitationsServiceForTests()
  await handle.teardown()
})

interface SeededOrg {
  organizationId: string
  inviterId: string
}

async function seedOrgWithInviter(): Promise<SeededOrg> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  const dbAny = handle.db as any
  const organizationId = nano()
  const inviterId = nano()
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
  return { organizationId, inviterId }
}

async function seedInvitation(
  org: SeededOrg,
  email: string,
  opts: { status?: string; expiresAt?: Date } = {},
): Promise<string> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  const dbAny = handle.db as any
  const id = nano()
  await dbAny.insert(authInvitation).values({
    id,
    organizationId: org.organizationId,
    email,
    role: 'member',
    status: opts.status ?? 'pending',
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    inviterId: org.inviterId,
  })
  return id
}

async function readRow(invitationId: string): Promise<{ status: string; expiresAt: Date } | null> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  const dbAny = handle.db as any
  const rows = (await dbAny
    .select({ status: authInvitation.status, expiresAt: authInvitation.expiresAt })
    .from(authInvitation)
    .where(eq(authInvitation.id, invitationId))
    .limit(1)) as Array<{ status: string; expiresAt: Date }>
  return rows[0] ?? null
}

describe('team invitations lifecycle', () => {
  it('lists pending invitations for the org, filtering by status + expiry + organizationId', async () => {
    const org = await seedOrgWithInviter()
    const otherOrg = await seedOrgWithInviter()

    const pendingId = await seedInvitation(org, `pending-${nano()}@meridian.test`)
    const canceledId = await seedInvitation(org, `canceled-${nano()}@meridian.test`, { status: 'canceled' })
    const expiredId = await seedInvitation(org, `expired-${nano()}@meridian.test`, {
      expiresAt: new Date(Date.now() - 60_000),
    })
    const otherOrgId = await seedInvitation(otherOrg, `other-${nano()}@meridian.test`)

    const rows = await listPending(org.organizationId)
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(pendingId)
    expect(ids).not.toContain(canceledId)
    expect(ids).not.toContain(expiredId)
    expect(ids).not.toContain(otherOrgId)

    const row = rows.find((r) => r.id === pendingId)
    expect(row?.email).toMatch(/^pending-/)
    expect(row?.role).toBe('member')
    expect(row?.inviterId).toBe(org.inviterId)
    expect(row?.inviterEmail).toContain('inviter-')
  })

  it('resend bumps expiresAt forward and notifies the team-roster cache', async () => {
    const org = await seedOrgWithInviter()
    // Seed with a near-expiry timestamp so we can assert the bump.
    const originalExpiresAt = new Date(Date.now() + 60_000)
    const invitationId = await seedInvitation(org, `resend-${nano()}@meridian.test`, {
      expiresAt: originalExpiresAt,
    })

    capturedNotifies.length = 0
    await resendInvitation(org.organizationId, invitationId)

    const after = await readRow(invitationId)
    expect(after?.status).toBe('pending')
    // New TTL should be > original (we add 48h on resend).
    expect(after?.expiresAt.getTime()).toBeGreaterThan(originalExpiresAt.getTime() + 60 * 60 * 1000)

    const notify = capturedNotifies.find((n) => n.id === invitationId)
    expect(notify?.table).toBe('auth_invitation')
    expect(notify?.action).toBe('resent')
  })

  it('revoke flips status to canceled and removes the row from the pending list', async () => {
    const org = await seedOrgWithInviter()
    const invitationId = await seedInvitation(org, `revoke-${nano()}@meridian.test`)

    // Confirm starting state.
    let rows = await listPending(org.organizationId)
    expect(rows.some((r) => r.id === invitationId)).toBe(true)

    capturedNotifies.length = 0
    await revokeInvitation(org.organizationId, invitationId)

    const after = await readRow(invitationId)
    expect(after?.status).toBe('canceled')

    rows = await listPending(org.organizationId)
    expect(rows.some((r) => r.id === invitationId)).toBe(false)

    const notify = capturedNotifies.find((n) => n.id === invitationId)
    expect(notify?.table).toBe('auth_invitation')
    expect(notify?.action).toBe('revoked')
  })

  it('resend rejects invitations from other orgs (org-scope leak guard)', async () => {
    const org = await seedOrgWithInviter()
    const otherOrg = await seedOrgWithInviter()
    const invitationId = await seedInvitation(otherOrg, `leak-${nano()}@meridian.test`)

    await expect(resendInvitation(org.organizationId, invitationId)).rejects.toThrow(/invitation/)
  })

  it('revoke rejects invitations from other orgs (org-scope leak guard)', async () => {
    const org = await seedOrgWithInviter()
    const otherOrg = await seedOrgWithInviter()
    const invitationId = await seedInvitation(otherOrg, `leak-${nano()}@meridian.test`)

    await expect(revokeInvitation(org.organizationId, invitationId)).rejects.toThrow(/invitation/)
  })

  it('resend rejects already-canceled invitations (status guard)', async () => {
    const org = await seedOrgWithInviter()
    const invitationId = await seedInvitation(org, `canceled-${nano()}@meridian.test`, { status: 'canceled' })
    await expect(resendInvitation(org.organizationId, invitationId)).rejects.toThrow(/invitation/)
  })

  it('re-invite of a revoked email succeeds and yields a new pending row', async () => {
    const org = await seedOrgWithInviter()
    const email = `repeat-${nano()}@meridian.test`
    const firstId = await seedInvitation(org, email)
    await revokeInvitation(org.organizationId, firstId)

    // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
    const dbAny = handle.db as any
    // Simulate a fresh better-auth `inviteMember` call writing a brand-new row
    // for the same email. better-auth itself enforces no-active-duplicate via
    // status filter, which is exactly what we revoked above.
    const secondId = nano()
    await dbAny.insert(authInvitation).values({
      id: secondId,
      organizationId: org.organizationId,
      email,
      role: 'member',
      status: 'pending',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      inviterId: org.inviterId,
    })

    const rows = await listPending(org.organizationId)
    const visible = rows.filter((r) => r.email === email).map((r) => r.id)
    expect(visible).toEqual([secondId])

    // First row is still there as a tombstone with status=canceled.
    const first = await dbAny
      .select({ status: authInvitation.status })
      .from(authInvitation)
      .where(and(eq(authInvitation.id, firstId), eq(authInvitation.organizationId, org.organizationId)))
      .limit(1)
    expect(first[0]?.status).toBe('canceled')
  })
})
