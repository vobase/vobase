/**
 * Unit tests for the `/staff/<staffId>/` materializers.
 *
 * The team `staff` service is module-scoped via `installStaffService`. Tests
 * install a stub implementation so these cases have no DB dependency.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  __resetStaffMemoryServiceForTests,
  installStaffMemoryService,
  type StaffMemoryService,
} from '@modules/agents/service/staff-memory'
import type { StaffProfile } from '@modules/team/schema'
import { __resetStaffServiceForTests, installStaffService, type StaffService } from '@modules/team/service/staff'

import { makeStaticProfileLookup, renderStaffMemory, renderStaffProfile } from './agent'

const STAFF_ID = 'u_alice'
const AGENT_ID = 'a_test'
const ORG_ID = 't1'

function makeStaffStub(profile: Partial<StaffProfile> | null): StaffService {
  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async find() {
      if (!profile) return null
      return {
        userId: STAFF_ID,
        organizationId: ORG_ID,
        displayName: null,
        title: null,
        sectors: [],
        expertise: [],
        languages: [],
        capacity: 10,
        availability: 'active',
        attributes: {},
        profile: '',
        notes: '',
        lastSeenAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...profile,
      } as StaffProfile
    },
  } as unknown as StaffService
}

function makeMemoryStub(initial: Record<string, string>): StaffMemoryService {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async read(key) {
      return store.get(`${key.organizationId}/${key.agentId}/${key.staffId}`) ?? ''
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async upsert(key, content) {
      store.set(`${key.organizationId}/${key.agentId}/${key.staffId}`, content)
    },
    listByStaff: () => Promise.resolve([]),
  }
}

describe('renderStaffProfile', () => {
  afterAll(() => {
    __resetStaffServiceForTests()
  })

  it('first line is `# <Display Name> (<staffId>)` when displayName is set', async () => {
    installStaffService(makeStaffStub({ displayName: 'Alice Example', title: 'Support Lead' }))
    const lookup = makeStaticProfileLookup({ [STAFF_ID]: { name: 'Alice Example', email: 'alice@example.com' } })
    const md = await renderStaffProfile(STAFF_ID, lookup)
    expect(md.split('\n')[0]).toBe(`# Alice Example (${STAFF_ID})`)
    expect(md).toContain('Title: Support Lead')
    expect(md).toContain('alice@example.com')
  })

  it('falls back to auth.name → email → staffId when staff_profiles is absent', async () => {
    installStaffService(makeStaffStub(null))
    const emailOnlyLookup = makeStaticProfileLookup({ [STAFF_ID]: { name: null, email: 'bob@example.com' } })
    const md1 = await renderStaffProfile(STAFF_ID, emailOnlyLookup)
    expect(md1.split('\n')[0]).toBe(`# bob@example.com (${STAFF_ID})`)

    const nameLookup = makeStaticProfileLookup({ [STAFF_ID]: { name: 'Bob', email: null } })
    const md2 = await renderStaffProfile(STAFF_ID, nameLookup)
    expect(md2.split('\n')[0]).toBe(`# Bob (${STAFF_ID})`)

    const emptyLookup = makeStaticProfileLookup({})
    const md3 = await renderStaffProfile(STAFF_ID, emptyLookup)
    expect(md3.split('\n')[0]).toBe(`# ${STAFF_ID} (${STAFF_ID})`)
  })
})

describe('renderStaffMemory', () => {
  beforeAll(() => {
    installStaffMemoryService(makeMemoryStub({ [`${ORG_ID}/${AGENT_ID}/${STAFF_ID}`]: '# seeded\n\nalready stored.' }))
  })

  afterAll(() => {
    __resetStaffMemoryServiceForTests()
  })

  it('returns the stored content when the row exists', async () => {
    const md = await renderStaffMemory({ organizationId: ORG_ID, agentId: AGENT_ID, staffId: STAFF_ID })
    expect(md).toContain('already stored')
  })

  it('returns the empty-memory stub when no row exists', async () => {
    const md = await renderStaffMemory({ organizationId: ORG_ID, agentId: AGENT_ID, staffId: 'u_missing' })
    expect(md).toContain('# Memory')
    expect(md).toContain('_empty_')
  })
})

describe('staff MEMORY.md round-trip', () => {
  afterAll(() => {
    __resetStaffMemoryServiceForTests()
  })

  it('write → re-materialize reflects the new content', async () => {
    const svc = makeMemoryStub({})
    installStaffMemoryService(svc)
    await svc.upsert(
      { organizationId: ORG_ID, agentId: AGENT_ID, staffId: STAFF_ID },
      '# Preferences\n\nMandarin-first.',
    )
    const md = await renderStaffMemory({ organizationId: ORG_ID, agentId: AGENT_ID, staffId: STAFF_ID })
    expect(md).toContain('Mandarin-first')
  })
})
