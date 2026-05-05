/**
 * Unit tests for the `/staff/<staffId>/` materializers.
 *
 * The team `staff` service is module-scoped via `installStaffService`. Tests
 * install a stub implementation so these cases have no DB dependency.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { AgentDefinition } from '@modules/agents/schema'
import {
  __resetStaffMemoryServiceForTests,
  installStaffMemoryService,
  type StaffMemoryService,
} from '@modules/agents/service/staff-memory'
import type { StaffProfile } from '@modules/team/schema'
import { __resetStaffServiceForTests, installStaffService, type StaffService } from '@modules/team/service/staff'
import type { MaterializerCtx, WorkspaceMaterializer } from '@vobase/core'

import type { WakeContext } from '~/wake/context'
import { makeStaticProfileLookup, renderStaffMemory, renderStaffProfile, teamMaterializerFactory } from './agent'

const MAT_CTX: MaterializerCtx = {
  organizationId: 't1',
  agentId: 'a_test',
  conversationId: 'conv_test',
  contactId: 'c_test',
  turnIndex: 0,
}

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

function makeWakeCtx(overrides: Partial<WakeContext> = {}): WakeContext {
  const agentDefinition = {
    id: AGENT_ID,
    organizationId: ORG_ID,
    name: 'Test Agent',
    slug: 'test-agent',
    model: 'gpt-4o',
    instructions: 'Be helpful.',
    workingMemory: '',
    scorerConfig: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  } as unknown as AgentDefinition
  return {
    organizationId: ORG_ID,
    agentId: AGENT_ID,
    contactId: 'c_test',
    channelInstanceId: 'ci_test',
    conversationId: 'conv_test',
    drive: {} as WakeContext['drive'],
    staffIds: [],
    budgetHeaderStaffIds: [],
    authLookup: makeStaticProfileLookup({}),
    agentDefinition,
    tools: [],
    agentsMdContributors: [],
    lane: 'conversation',
    triggerKind: 'inbound_message',
    audienceTier: 'contact',
    ...overrides,
  } as WakeContext
}

async function runMaterializer(mat: WorkspaceMaterializer): Promise<string> {
  const out = await mat.materialize(MAT_CTX)
  return typeof out === 'string' ? out : ''
}

describe('teamMaterializerFactory budget header', () => {
  beforeAll(() => {
    installStaffService(makeStaffStub({ displayName: 'Alice' }))
    installStaffMemoryService(
      makeMemoryStub({
        [`${ORG_ID}/${AGENT_ID}/u_a`]: '# Memory\n\n- handles refunds\n',
        [`${ORG_ID}/${AGENT_ID}/u_b`]: '# Memory\n\n- after-hours support\n',
        [`${ORG_ID}/${AGENT_ID}/u_c`]: '# Memory\n\n- backup\n',
      }),
    )
  })

  afterAll(() => {
    __resetStaffServiceForTests()
    __resetStaffMemoryServiceForTests()
  })

  it('prepends scope=staff header for ids in budgetHeaderStaffIds', async () => {
    const ctx = makeWakeCtx({ staffIds: ['u_a', 'u_b'], budgetHeaderStaffIds: ['u_a', 'u_b'] })
    const mats = teamMaterializerFactory(ctx)
    const memA = mats.find((m) => m.path === '/staff/u_a/MEMORY.md')
    const memB = mats.find((m) => m.path === '/staff/u_b/MEMORY.md')
    expect(memA && memB).toBeTruthy()
    if (!memA || !memB) return
    const a = await runMaterializer(memA)
    const b = await runMaterializer(memB)
    expect(a).toMatch(/^<!-- memory-budget scope=staff id=u_a chars=\d+ \(utf16\) cap=8000 over=(true|false) -->\n/)
    expect(b).toMatch(/^<!-- memory-budget scope=staff id=u_b chars=\d+ \(utf16\) cap=8000 over=(true|false) -->\n/)
    expect(a).toContain('handles refunds')
    expect(b).toContain('after-hours support')
  })

  it('omits the budget header for staffIds outside budgetHeaderStaffIds (still materializes body)', async () => {
    const ctx = makeWakeCtx({ staffIds: ['u_a', 'u_b', 'u_c'], budgetHeaderStaffIds: ['u_a'] })
    const mats = teamMaterializerFactory(ctx)
    const memA = mats.find((m) => m.path === '/staff/u_a/MEMORY.md')
    const memB = mats.find((m) => m.path === '/staff/u_b/MEMORY.md')
    const memC = mats.find((m) => m.path === '/staff/u_c/MEMORY.md')
    expect(memA && memB && memC).toBeTruthy()
    if (!memA || !memB || !memC) return
    const a = await runMaterializer(memA)
    const b = await runMaterializer(memB)
    const c = await runMaterializer(memC)
    expect(a.startsWith('<!-- memory-budget scope=staff id=u_a')).toBe(true)
    expect(b.startsWith('<!-- memory-budget')).toBe(false)
    expect(c.startsWith('<!-- memory-budget')).toBe(false)
    expect(b).toContain('after-hours support')
    expect(c).toContain('backup')
  })

  // biome-ignore lint/suspicious/useAwait: bun:test it() callback signature kept async for parity with sibling cases
  it('still emits profile.md and MEMORY.md for every staff id, regardless of budget cap', async () => {
    const ctx = makeWakeCtx({ staffIds: ['u_a', 'u_b', 'u_c'], budgetHeaderStaffIds: ['u_a'] })
    const mats = teamMaterializerFactory(ctx)
    const paths = mats.map((m) => m.path).sort()
    expect(paths).toEqual([
      '/staff/u_a/MEMORY.md',
      '/staff/u_a/profile.md',
      '/staff/u_b/MEMORY.md',
      '/staff/u_b/profile.md',
      '/staff/u_c/MEMORY.md',
      '/staff/u_c/profile.md',
    ])
  })

  it('two same-input calls produce byte-identical output', async () => {
    const ctx = makeWakeCtx({ staffIds: ['u_a'], budgetHeaderStaffIds: ['u_a'] })
    const a = await runMaterializer(
      teamMaterializerFactory(ctx).find((m) => m.path === '/staff/u_a/MEMORY.md') as WorkspaceMaterializer,
    )
    const b = await runMaterializer(
      teamMaterializerFactory(ctx).find((m) => m.path === '/staff/u_a/MEMORY.md') as WorkspaceMaterializer,
    )
    expect(a).toBe(b)
  })
})
