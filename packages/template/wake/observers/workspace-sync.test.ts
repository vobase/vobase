/**
 * Regression net for the motivating "GK Corp" memory bug — verifies the
 * `agent_end → tracker.flush → FilesService.writePath / upsertStaffMemory`
 * chain fires exactly once per scope when an agent appends to a MEMORY.md
 * file mid-wake.
 *
 * No real DB, no real Drizzle. Collaborators are typed `satisfies` the real
 * shapes from `@modules/drive/service/files` / `@modules/agents/service/staff-memory`
 * so a future signature change will fail `bun run typecheck` even if this
 * test never runs in CI.
 *
 * PROFILE.md flush behaviour (`field_set` proposals from frontmatter edits)
 * was removed when PROFILE.md became RO at the workspace level — those edits
 * now flow through the `vobase contacts propose-change` CLI verb, not this
 * observer.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
  __resetStaffMemoryServiceForTests,
  installStaffMemoryService,
  type StaffMemoryService,
} from '@modules/agents/service/staff-memory'
import type { FilesService } from '@modules/drive/service/files'
import type { DirtyDiff, DirtyTracker, HarnessLogger } from '@vobase/core'
import { InMemoryFs } from 'just-bash'

import type { AgentEvent } from '../events'
import { createWorkspaceSyncListener } from './workspace-sync'

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
    contactDrive: emptyDiff(),
    staffMemory: new Map(),
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
