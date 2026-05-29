/**
 * Integration tests for the lead-routing service against real Postgres.
 * Requires Docker Postgres running (see `tests/helpers/test-db.ts`).
 *
 * Covers the DB-bound routing paths the pure-helper unit tests
 * (`lead-routing.test.ts`) cannot: exclusive keyword → rep, pool round-robin,
 * `off` reps skipped, and the corporate / private team-lead fallbacks. Team
 * membership + lead status are driven by `staff_profiles.attributes` booleans
 * (`corporate_team`, `private_team`, `team_lead`). The `lastOwnerAssignedAt`
 * reader is stubbed so round-robin order is deterministic — the reader itself
 * is messaging's concern and tested there.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { ALICE_USER_ID, BOB_USER_ID, CAROL_USER_ID } from '@modules/contacts/seed'
import { routingRules, staffProfiles } from '@modules/team/schema'
import { eq } from 'drizzle-orm'

import { getSeededOrgId } from '../../../tests/helpers/seeded-org'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'
import { createLeadRoutingService, installLeadRoutingService, type LeadRoutingService } from './lead-routing'

let db: TestDbHandle
let organizationId: string
let svc: LeadRoutingService

/** Deterministic LRA stub — every candidate never-assigned, so round-robin picks by userId asc. */
const neverAssigned = async (userIds: string[]) => new Map<string, Date | null>(userIds.map((id) => [id, null]))

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  organizationId = await getSeededOrgId(db.db)
  svc = createLeadRoutingService({ db: db.db })
  installLeadRoutingService(svc)

  // Attribute-driven team membership:
  //   ALICE → corporate_team
  //   BOB   → private_team
  //   CAROL → corporate_team AND private_team AND team_lead (joint lead)
  await db.db
    .update(staffProfiles)
    .set({ attributes: { corporate_team: true } })
    .where(eq(staffProfiles.userId, ALICE_USER_ID))
  await db.db
    .update(staffProfiles)
    .set({ attributes: { private_team: true } })
    .where(eq(staffProfiles.userId, BOB_USER_ID))
  // CAROL is the Corporate team lead (`corporate_team=true, team_lead=true`)
  // and also a Private team member who is themselves a lead
  // (`private_team=true, team_lead=true`) — exercising the joint case.
  await db.db
    .update(staffProfiles)
    .set({ attributes: { corporate_team: true, private_team: true, team_lead: true } })
    .where(eq(staffProfiles.userId, CAROL_USER_ID))

  // Routing rules: exclusive sgx → ALICE; pool "uni" keyword "nus" with ALICE + BOB.
  await db.db.insert(routingRules).values([
    { organizationId, kind: 'exclusive', keyword: 'sgx', pool: null, repUserId: ALICE_USER_ID, priority: 0 },
    { organizationId, kind: 'pool_keyword', keyword: 'nus', pool: 'uni', repUserId: null, priority: 0 },
    { organizationId, kind: 'pool_member', keyword: null, pool: 'uni', repUserId: ALICE_USER_ID, priority: 0 },
    { organizationId, kind: 'pool_member', keyword: null, pool: 'uni', repUserId: BOB_USER_ID, priority: 0 },
  ])
}, 120_000)

afterAll(async () => {
  if (db) await db.teardown()
})

beforeEach(async () => {
  // Reset everyone to available before each test. Attribute membership stays
  // as the boot-time fixture — it's the routing topology, not per-test state.
  await db.db
    .update(staffProfiles)
    .set({ availability: 'active' })
    .where(eq(staffProfiles.organizationId, organizationId))
})

describe('routeLead — corporate', () => {
  it('routes an exclusive keyword match to its rep', async () => {
    const d = await svc.routeLead({
      organizationId,
      inquiryType: 'corporate',
      companyName: 'SGX Group',
      lastOwnerAssignedAt: neverAssigned,
    })
    expect(d.ownerUserId).toBe(ALICE_USER_ID)
    expect(d.matchKind).toBe('exclusive')
  })

  it('routes a pool keyword to a round-robin member', async () => {
    const d = await svc.routeLead({
      organizationId,
      inquiryType: 'corporate',
      industry: 'nus faculty of science',
      lastOwnerAssignedAt: neverAssigned,
    })
    expect(d.matchKind).toBe('pool')
    expect(d.ownerUserId === ALICE_USER_ID || d.ownerUserId === BOB_USER_ID).toBe(true)
  })

  it('skips an `off` pool member', async () => {
    await db.db.update(staffProfiles).set({ availability: 'off' }).where(eq(staffProfiles.userId, ALICE_USER_ID))
    const d = await svc.routeLead({
      organizationId,
      inquiryType: 'corporate',
      industry: 'nus campus',
      lastOwnerAssignedAt: neverAssigned,
    })
    expect(d.ownerUserId).toBe(BOB_USER_ID)
  })

  it('falls back to the Corporate team lead when nothing matches', async () => {
    const d = await svc.routeLead({
      organizationId,
      inquiryType: 'corporate',
      companyName: 'Unrecognised Widgets Ltd',
      lastOwnerAssignedAt: neverAssigned,
    })
    expect(d.ownerUserId).toBe(CAROL_USER_ID)
    expect(d.matchKind).toBe('corporate_lead')
  })
})

describe('routeLead — private', () => {
  it('round-robins across the Private team', async () => {
    const d = await svc.routeLead({
      organizationId,
      inquiryType: 'private',
      lastOwnerAssignedAt: neverAssigned,
    })
    expect(d.ownerUserId).toBe(BOB_USER_ID)
    expect(d.matchKind).toBe('private')
  })

  it('routes to the only available Private member (CAROL is a joint lead and member)', async () => {
    // BOB is the non-lead member; CAROL is `private_team=true AND
    // team_lead=true`. When BOB is off, CAROL is still in the regular
    // `private_team` set, so the first path picks her — `matchKind: 'private'`,
    // not `'private_lead'`. Under the new strict-intersection semantics, a
    // Private team lead is also a Private team member, so the lead-fallback
    // step is only reached when no `private_team` member at all is available
    // (in which case the intersection is empty too → unrouted).
    await db.db.update(staffProfiles).set({ availability: 'off' }).where(eq(staffProfiles.userId, BOB_USER_ID))
    const d = await svc.routeLead({
      organizationId,
      inquiryType: 'private',
      lastOwnerAssignedAt: neverAssigned,
    })
    expect(d.ownerUserId).toBe(CAROL_USER_ID)
    expect(d.matchKind).toBe('private')
  })

  it('returns unrouted when every Private team member is unavailable', async () => {
    await db.db
      .update(staffProfiles)
      .set({ availability: 'off' })
      .where(eq(staffProfiles.organizationId, organizationId))
    const d = await svc.routeLead({
      organizationId,
      inquiryType: 'private',
      lastOwnerAssignedAt: neverAssigned,
    })
    expect(d.ownerUserId).toBeNull()
    expect(d.matchKind).toBe('unrouted')
  })
})
