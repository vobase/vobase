/**
 * Regression net for the motivating "GK Corp" memory bug — verifies the
 * `agent_end → tracker.flush → FilesService.writePath / upsertStaffMemory`
 * chain fires exactly once per scope when an agent appends to a MEMORY.md
 * file mid-wake. Also covers the profile.md → field_set proposal path added
 * for the profile-frontmatter ADR.
 *
 * No real DB, no real Drizzle. Collaborators are typed `satisfies` the real
 * shapes from `@modules/drive/service/files` / `@modules/agents/service/staff-memory`
 * so a future signature change will fail `bun run typecheck` even if this
 * test never runs in CI.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'

const insertedProposals: Array<Record<string, unknown>> = []

mock.module('@modules/changes/service/proposals', () => ({
  insertProposal: (input: Record<string, unknown>) => {
    insertedProposals.push(input)
    return Promise.resolve({ id: 'p_fake', status: 'auto_written' })
  },
}))

import {
  __resetStaffMemoryServiceForTests,
  installStaffMemoryService,
  type StaffMemoryService,
} from '@modules/agents/service/staff-memory'
import type { Contact } from '@modules/contacts/schema'
import {
  __resetContactsServiceForTests,
  type ContactsService,
  installContactsService,
} from '@modules/contacts/service/contacts'
import type { FilesService } from '@modules/drive/service/files'
import type { StaffProfile } from '@modules/team/schema'
import { __resetStaffServiceForTests, installStaffService, type StaffService } from '@modules/team/service/staff'
import type { DirtyDiff, DirtyTracker, HarnessLogger } from '@vobase/core'
import { InMemoryFs } from 'just-bash'

import type { AgentEvent } from '../events'
import { renderContactFrontmatter, renderStaffFrontmatter } from '../profile-frontmatter'
import { createWorkspaceSyncListener } from './workspace-sync'

let stubContact: Contact | null = null
let stubStaffProfile: StaffProfile | null = null

function makeContactsStub(): ContactsService {
  const notImpl = (): never => {
    throw new Error('not implemented')
  }
  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async get() {
      if (!stubContact) throw new Error('contact not found')
      return stubContact
    },
    list: notImpl,
    findById: notImpl,
    upsertByExternalKey: notImpl,
    update: notImpl,
    setAttributes: notImpl,
    appendNote: notImpl,
    readMemory: notImpl,
    writeMemory: notImpl,
    upsertMemorySection: notImpl,
    readProfile: notImpl,
    writeProfile: notImpl,
    getByPhone: notImpl,
    getByEmail: notImpl,
    setRealtime: notImpl,
  } as unknown as ContactsService
}

function makeTeamStaffStub(): StaffService {
  const notImpl = (): never => {
    throw new Error('not implemented')
  }
  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async find() {
      return stubStaffProfile
    },
    list: notImpl,
    get: notImpl,
    upsert: notImpl,
    update: notImpl,
    remove: notImpl,
    setAttributes: notImpl,
    touchLastSeen: notImpl,
    readMemory: notImpl,
    writeMemory: notImpl,
    upsertMemorySection: notImpl,
    readProfile: notImpl,
    writeProfile: notImpl,
  } as unknown as StaffService
}

type ScopedDiff = Awaited<ReturnType<DirtyTracker['flush']>>

const ORG = 'org_test'
const AGENT = 'a_test'
const CONTACT = 'c_test'
const STAFF = 'u_alice'

function emptyDiff(): DirtyDiff {
  return { added: [], changed: [], deleted: [] }
}

function emptyScoped(): ScopedDiff {
  return {
    agentMemory: emptyDiff(),
    contactMemory: emptyDiff(),
    contactProfile: emptyDiff(),
    contactDrive: emptyDiff(),
    staffMemory: new Map(),
    staffProfile: new Map(),
    tmp: emptyDiff(),
  }
}

function makeLogger(): HarnessLogger {
  return {
    info: mock(() => undefined),
    warn: mock(() => undefined),
    error: mock(() => undefined),
    debug: mock(() => undefined),
  } as unknown as HarnessLogger
}

function makeAgentEnd(): AgentEvent {
  return {
    type: 'agent_end',
    ts: new Date('2026-05-05T00:00:00Z'),
    wakeId: 'wake-test',
    conversationId: 'conv-test',
    organizationId: ORG,
    turnIndex: 1,
    reason: 'complete',
  } as AgentEvent
}

interface FakeFilesService {
  writes: Array<{ scope: { scope: string; agentId?: string; contactId?: string }; path: string; content: string }>
  service: Pick<FilesService, 'writePath'>
}

function makeFilesServiceFake(): FakeFilesService {
  const writes: FakeFilesService['writes'] = []
  const service = {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async writePath(scope, path, content) {
      writes.push({ scope, path, content })
      return null
    },
  } satisfies Pick<FilesService, 'writePath'>
  return { writes, service }
}

interface StaffMemoryFake {
  upserts: Array<{ key: { organizationId: string; agentId: string; staffId: string }; memory: string }>
  service: StaffMemoryService
}

function makeStaffMemoryFake(): StaffMemoryFake {
  const upserts: StaffMemoryFake['upserts'] = []
  const service: StaffMemoryService = {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async read() {
      return ''
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async upsert(key, memory) {
      upserts.push({ key, memory })
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async listByStaff() {
      return []
    },
  }
  return { upserts, service }
}

function makeTracker(scoped: ScopedDiff = emptyScoped()): DirtyTracker {
  return {
    // biome-ignore lint/suspicious/useAwait: matches real DirtyTracker.flush signature
    async flush() {
      return scoped
    },
  } as unknown as DirtyTracker
}

beforeEach(() => {
  insertedProposals.length = 0
  installContactsService(makeContactsStub())
  installStaffService(makeTeamStaffStub())
})

afterEach(() => {
  insertedProposals.length = 0
  stubContact = null
  stubStaffProfile = null
  __resetContactsServiceForTests()
  __resetStaffServiceForTests()
})

describe('createWorkspaceSyncListener — agent scope', () => {
  let staff: StaffMemoryFake
  beforeAll(() => {
    staff = makeStaffMemoryFake()
    installStaffMemoryService(staff.service)
  })
  afterEach(() => {
    staff.upserts.length = 0
  })

  it('flushes /agents/<id>/MEMORY.md exactly once via FilesService.writePath on agent_end', async () => {
    const fs = new InMemoryFs()
    await fs.mkdir(`/agents/${AGENT}`, { recursive: true })
    await fs.writeFile(`/agents/${AGENT}/MEMORY.md`, '# Memory\n\n- always lead with price\n')
    const files = makeFilesServiceFake()
    const listener = createWorkspaceSyncListener({
      fs,
      tracker: makeTracker({
        ...emptyScoped(),
        agentMemory: { added: [`/agents/${AGENT}/MEMORY.md`], changed: [], deleted: [] },
      }),
      organizationId: ORG,
      agentId: AGENT,
      contactId: CONTACT,
      drive: files.service as unknown as FilesService,
      logger: makeLogger(),
    })
    await listener(makeAgentEnd())
    expect(files.writes).toHaveLength(1)
    expect(files.writes[0].scope).toEqual({ scope: 'agent', agentId: AGENT })
    expect(files.writes[0].path).toBe('/MEMORY.md')
    expect(files.writes[0].content).toContain('always lead with price')
  })
})

describe('createWorkspaceSyncListener — contact scope', () => {
  let staff: StaffMemoryFake
  beforeAll(() => {
    staff = makeStaffMemoryFake()
    installStaffMemoryService(staff.service)
  })
  afterEach(() => {
    staff.upserts.length = 0
  })

  it('flushes /contacts/<id>/MEMORY.md exactly once via FilesService.writePath on agent_end', async () => {
    const fs = new InMemoryFs()
    await fs.mkdir(`/contacts/${CONTACT}`, { recursive: true })
    await fs.writeFile(`/contacts/${CONTACT}/MEMORY.md`, '# Memory\n\n- from GK Corp\n')
    const files = makeFilesServiceFake()
    const listener = createWorkspaceSyncListener({
      fs,
      tracker: makeTracker({
        ...emptyScoped(),
        contactMemory: { added: [`/contacts/${CONTACT}/MEMORY.md`], changed: [], deleted: [] },
      }),
      organizationId: ORG,
      agentId: AGENT,
      contactId: CONTACT,
      drive: files.service as unknown as FilesService,
      logger: makeLogger(),
    })
    await listener(makeAgentEnd())
    expect(files.writes).toHaveLength(1)
    expect(files.writes[0].scope).toEqual({ scope: 'contact', contactId: CONTACT })
    expect(files.writes[0].path).toBe('/MEMORY.md')
    expect(files.writes[0].content).toContain('from GK Corp')
  })
})

describe('createWorkspaceSyncListener — staff scope', () => {
  let staff: StaffMemoryFake
  beforeEach(() => {
    staff = makeStaffMemoryFake()
    installStaffMemoryService(staff.service)
  })
  afterEach(() => {
    __resetStaffMemoryServiceForTests()
  })

  it('flushes /staff/<staffId>/MEMORY.md exactly once via upsertStaffMemory on agent_end', async () => {
    const fs = new InMemoryFs()
    await fs.mkdir(`/staff/${STAFF}`, { recursive: true })
    await fs.writeFile(`/staff/${STAFF}/MEMORY.md`, '# Memory\n\n- handles refunds via card\n')
    const files = makeFilesServiceFake()
    const tracker = makeTracker({
      ...emptyScoped(),
      staffMemory: new Map([[STAFF, { added: [`/staff/${STAFF}/MEMORY.md`], changed: [], deleted: [] }]]),
    })
    const listener = createWorkspaceSyncListener({
      fs,
      tracker,
      organizationId: ORG,
      agentId: AGENT,
      contactId: CONTACT,
      drive: files.service as unknown as FilesService,
      logger: makeLogger(),
    })
    await listener(makeAgentEnd())
    expect(staff.upserts).toHaveLength(1)
    expect(staff.upserts[0].key).toEqual({ organizationId: ORG, agentId: AGENT, staffId: STAFF })
    expect(staff.upserts[0].memory).toContain('handles refunds via card')
    // Staff scope must NOT route through FilesService.writePath.
    expect(files.writes).toHaveLength(0)
  })

  it('does not fire on non-agent_end events', async () => {
    const fs = new InMemoryFs()
    await fs.mkdir(`/agents/${AGENT}`, { recursive: true })
    await fs.writeFile(`/agents/${AGENT}/MEMORY.md`, 'x')
    const files = makeFilesServiceFake()
    const tracker = makeTracker({
      ...emptyScoped(),
      agentMemory: { added: [`/agents/${AGENT}/MEMORY.md`], changed: [], deleted: [] },
    })
    const listener = createWorkspaceSyncListener({
      fs,
      tracker,
      organizationId: ORG,
      agentId: AGENT,
      contactId: CONTACT,
      drive: files.service as unknown as FilesService,
      logger: makeLogger(),
    })
    await listener({
      type: 'turn_end',
      ts: new Date('2026-05-05T00:00:00Z'),
      wakeId: 'wake-test',
      conversationId: 'conv-test',
      organizationId: ORG,
      turnIndex: 1,
    } as AgentEvent)
    expect(files.writes).toHaveLength(0)
    expect(staff.upserts).toHaveLength(0)
  })
})

// ─── Profile.md → field_set proposals ────────────────────────────────────────

function baselineContact() {
  return {
    id: CONTACT,
    organizationId: ORG,
    displayName: 'Marcus',
    phone: '+6591234567',
    email: 'marcus@northwind.sg',
    profile: '',
    memory: '',
    attributes: { industry: 'tech' },
    segments: [],
    marketingOptOut: false,
    marketingOptOutAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }
}

function baselineStaff() {
  return {
    userId: STAFF,
    organizationId: ORG,
    displayName: 'Alice',
    title: 'CSM',
    sectors: [],
    expertise: [],
    languages: [],
    capacity: 10,
    availability: 'active' as const,
    attributes: {},
    profile: '',
    memory: '',
    lastSeenAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }
}

async function runWithProfileEdit(opts: {
  workspacePath: string
  workspaceBody: string
}): Promise<{ files: FakeFilesService; logger: HarnessLogger }> {
  const fs = new InMemoryFs()
  const dir = opts.workspacePath.split('/').slice(0, -1).join('/')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(opts.workspacePath, opts.workspaceBody)
  const files = makeFilesServiceFake()
  const logger = makeLogger()

  const dirty: DirtyDiff = { added: [], changed: [opts.workspacePath], deleted: [] }
  const scoped = emptyScoped()
  const staffMatch = opts.workspacePath.match(/^\/staff\/([^/]+)\/profile\.md$/)
  if (staffMatch) {
    scoped.staffProfile.set(staffMatch[1], dirty)
  } else {
    scoped.contactProfile = dirty
  }

  const listener = createWorkspaceSyncListener({
    fs,
    tracker: makeTracker(scoped),
    organizationId: ORG,
    agentId: AGENT,
    contactId: CONTACT,
    drive: files.service as unknown as FilesService,
    logger,
  })
  await listener(makeAgentEnd())
  return { files, logger }
}

describe('createWorkspaceSyncListener — contact profile.md', () => {
  it('emits one field_set proposal when one frontmatter scalar changes', async () => {
    stubContact = baselineContact()
    const baselineMd = renderContactFrontmatter(baselineContact() as never)
    // Tweak phone in the workspace copy.
    const edited = baselineMd.replace('+6591234567', '+6598888888')
    await runWithProfileEdit({ workspacePath: `/contacts/${CONTACT}/profile.md`, workspaceBody: edited })

    expect(insertedProposals).toHaveLength(1)
    const call = insertedProposals[0] as Record<string, unknown>
    expect(call.resourceModule).toBe('contacts')
    expect(call.resourceType).toBe('contact')
    expect(call.resourceId).toBe(CONTACT)
    const payload = call.payload as { kind: string; fields: Record<string, { from: unknown; to: unknown }> }
    expect(payload.kind).toBe('field_set')
    expect(payload.fields).toEqual({ phone: { from: '+6591234567', to: '+6598888888' } })
  })

  it('emits zero proposals when only the key order is reshuffled', async () => {
    stubContact = baselineContact()
    const rendered = renderContactFrontmatter(baselineContact() as never)
    // Re-render is byte-stable; this also exercises the parser baseline path.
    await runWithProfileEdit({ workspacePath: `/contacts/${CONTACT}/profile.md`, workspaceBody: rendered })
    expect(insertedProposals).toHaveLength(0)
  })

  it('emits zero proposals + warns when the workspace body is malformed YAML', async () => {
    stubContact = baselineContact()
    const { logger } = await runWithProfileEdit({
      workspacePath: `/contacts/${CONTACT}/profile.md`,
      workspaceBody: '---\n: : :\n---\n# heading\n',
    })
    expect(insertedProposals).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('drops unknown frontmatter keys before insertProposal and warns', async () => {
    stubContact = baselineContact()
    // displayName change (recognised) + bogus key (must be dropped).
    const body = '---\ndisplayName: "Marcus T."\nphone: "+6591234567"\nbogusKey: "x"\n---\n# Marcus T.\n'
    const { logger } = await runWithProfileEdit({
      workspacePath: `/contacts/${CONTACT}/profile.md`,
      workspaceBody: body,
    })
    expect(insertedProposals).toHaveLength(1)
    const fields = (insertedProposals[0]?.payload as { fields: Record<string, unknown> }).fields
    expect(Object.keys(fields)).toContain('displayName')
    expect(Object.keys(fields)).not.toContain('bogusKey')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('emits one proposal when a single attributes.* key changes', async () => {
    stubContact = baselineContact()
    const baselineMd = renderContactFrontmatter(baselineContact() as never)
    const edited = baselineMd.replace('industry: "tech"', 'industry: "logistics"')
    await runWithProfileEdit({ workspacePath: `/contacts/${CONTACT}/profile.md`, workspaceBody: edited })
    expect(insertedProposals).toHaveLength(1)
    const fields = (insertedProposals[0]?.payload as { fields: Record<string, unknown> }).fields
    expect(fields).toEqual({ 'attributes.industry': { from: 'tech', to: 'logistics' } })
  })
})

describe('createWorkspaceSyncListener — staff profile.md', () => {
  it('emits one field_set proposal targeting (team, staff) when a scalar changes', async () => {
    stubStaffProfile = baselineStaff()
    const baselineMd = renderStaffFrontmatter(baselineStaff() as never)
    const edited = baselineMd.replace('title: "CSM"', 'title: "Senior CSM"')
    await runWithProfileEdit({ workspacePath: `/staff/${STAFF}/profile.md`, workspaceBody: edited })

    expect(insertedProposals).toHaveLength(1)
    const call = insertedProposals[0] as Record<string, unknown>
    expect(call.resourceModule).toBe('team')
    expect(call.resourceType).toBe('staff')
    expect(call.resourceId).toBe(STAFF)
    const fields = (call.payload as { fields: Record<string, unknown> }).fields
    expect(fields).toEqual({ title: { from: 'CSM', to: 'Senior CSM' } })
  })

  it('emits zero proposals when staff profile is missing in the row store', async () => {
    stubStaffProfile = null
    const body = '---\ntitle: "Senior CSM"\n---\n# Alice (u_alice)\n'
    const { logger } = await runWithProfileEdit({
      workspacePath: `/staff/${STAFF}/profile.md`,
      workspaceBody: body,
    })
    expect(insertedProposals).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalled()
  })
})
