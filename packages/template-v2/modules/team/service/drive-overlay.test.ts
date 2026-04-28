import { beforeEach, describe, expect, it } from 'bun:test'
import type { StaffMemoryEntry, StaffMemoryService } from '@modules/agents/service/staff-memory'
import { __resetStaffMemoryServiceForTests, installStaffMemoryService } from '@modules/agents/service/staff-memory'
import { __resetOverlaysForTests } from '@modules/drive/service/overlays'
import { formatProviderId } from '@modules/drive/service/virtual-ids'

import { STAFF_MEMORY_PROVIDER_ID, staffCrossAgentMemoryOverlay } from './drive-overlay'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeScope(userId: string) {
  return { scope: 'staff' as const, userId }
}

function makeEntry(agentId: string, agentName: string, memory = '', updatedAt: Date = new Date()): StaffMemoryEntry {
  return { agentId, agentName, memory, updatedAt }
}

function stubService(entries: StaffMemoryEntry[]): StaffMemoryService {
  return {
    async read() {
      return ''
    },
    async upsert() {},
    async listByStaff() {
      return entries
    },
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('staffCrossAgentMemoryOverlay', () => {
  beforeEach(() => {
    __resetOverlaysForTests()
    __resetStaffMemoryServiceForTests()
  })
  const ORG_A = 'orgA'
  const ORG_B = 'orgB'
  const STAFF_ID = 'staff1'
  const AGENT_1 = { id: 'agent1', name: 'Triage' }
  const AGENT_2 = { id: 'agent2', name: 'Reply' }

  it('returns empty list when staff has no memory entries (parentId=null)', async () => {
    installStaffMemoryService(stubService([]))
    const rows = await staffCrossAgentMemoryOverlay.list({
      scope: makeScope(STAFF_ID),
      parentId: null,
      organizationId: ORG_A,
    })
    expect(rows).toEqual([])
  })

  it('returns /agents folder at root when entries exist', async () => {
    installStaffMemoryService(stubService([makeEntry(AGENT_1.id, AGENT_1.name)]))
    const rows = await staffCrossAgentMemoryOverlay.list({
      scope: makeScope(STAFF_ID),
      parentId: null,
      organizationId: ORG_A,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'folder', name: 'agents', path: '/agents', parentFolderId: null })
  })

  it('returns one folder per agent inside /agents', async () => {
    installStaffMemoryService(stubService([makeEntry(AGENT_1.id, AGENT_1.name), makeEntry(AGENT_2.id, AGENT_2.name)]))
    const agentsDirId = formatProviderId(STAFF_MEMORY_PROVIDER_ID, STAFF_ID, 'agents-dir')
    const rows = await staffCrossAgentMemoryOverlay.list({
      scope: makeScope(STAFF_ID),
      parentId: agentsDirId,
      organizationId: ORG_A,
    })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.name)).toEqual([AGENT_1.name, AGENT_2.name])
    expect(rows.every((r) => r.kind === 'folder')).toBe(true)
  })

  it('returns MEMORY.md inside per-agent folder', async () => {
    installStaffMemoryService(stubService([makeEntry(AGENT_1.id, AGENT_1.name, '# Hello')]))
    const agentFolderId = formatProviderId(STAFF_MEMORY_PROVIDER_ID, STAFF_ID, `agent:${AGENT_1.id}`)
    const rows = await staffCrossAgentMemoryOverlay.list({
      scope: makeScope(STAFF_ID),
      parentId: agentFolderId,
      organizationId: ORG_A,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'file', name: 'MEMORY.md', mimeType: 'text/markdown' })
  })

  it('read returns content for /agents/<agentName>/MEMORY.md', async () => {
    const content = '## Context\nsome memory'
    const updatedAt = new Date('2026-01-15T10:00:00Z')
    installStaffMemoryService(stubService([makeEntry(AGENT_1.id, AGENT_1.name, content, updatedAt)]))
    const result = await staffCrossAgentMemoryOverlay.read({
      scope: makeScope(STAFF_ID),
      path: `/agents/${AGENT_1.name}/MEMORY.md`,
      organizationId: ORG_A,
    })
    expect(result).toEqual({ content, updatedAt })
  })

  it('read returns null for non-MEMORY.md path', async () => {
    installStaffMemoryService(stubService([makeEntry(AGENT_1.id, AGENT_1.name)]))
    const result = await staffCrossAgentMemoryOverlay.read({
      scope: makeScope(STAFF_ID),
      path: '/agents/Triage/OTHER.md',
      organizationId: ORG_A,
    })
    expect(result).toBeNull()
  })

  it('read returns null when agentName not found', async () => {
    installStaffMemoryService(stubService([makeEntry(AGENT_1.id, AGENT_1.name)]))
    const result = await staffCrossAgentMemoryOverlay.read({
      scope: makeScope(STAFF_ID),
      path: '/agents/Ghost/MEMORY.md',
      organizationId: ORG_A,
    })
    expect(result).toBeNull()
  })

  it('list rows surface real updatedAt (not epoch) — rolled up from agent_staff_memory.updatedAt', async () => {
    const recent = new Date('2026-04-20T12:00:00Z')
    const older = new Date('2026-01-05T08:00:00Z')
    installStaffMemoryService(
      stubService([makeEntry(AGENT_1.id, AGENT_1.name, '', older), makeEntry(AGENT_2.id, AGENT_2.name, '', recent)]),
    )

    // /agents folder rolls up to the max child updatedAt
    const rootRows = await staffCrossAgentMemoryOverlay.list({
      scope: makeScope(STAFF_ID),
      parentId: null,
      organizationId: ORG_A,
    })
    expect(rootRows).toHaveLength(1)
    expect(rootRows[0].updatedAt.getTime()).toBe(recent.getTime())

    // Per-agent folder reflects its own staff-memory updatedAt
    const agentsDirId = formatProviderId(STAFF_MEMORY_PROVIDER_ID, STAFF_ID, 'agents-dir')
    const folderRows = await staffCrossAgentMemoryOverlay.list({
      scope: makeScope(STAFF_ID),
      parentId: agentsDirId,
      organizationId: ORG_A,
    })
    const folder1 = folderRows.find((r) => r.name === AGENT_1.name)
    const folder2 = folderRows.find((r) => r.name === AGENT_2.name)
    expect(folder1?.updatedAt.getTime()).toBe(older.getTime())
    expect(folder2?.updatedAt.getTime()).toBe(recent.getTime())

    // MEMORY.md leaf reflects its own staff-memory updatedAt
    const agent1FolderId = formatProviderId(STAFF_MEMORY_PROVIDER_ID, STAFF_ID, `agent:${AGENT_1.id}`)
    const leafRows = await staffCrossAgentMemoryOverlay.list({
      scope: makeScope(STAFF_ID),
      parentId: agent1FolderId,
      organizationId: ORG_A,
    })
    expect(leafRows[0].updatedAt.getTime()).toBe(older.getTime())
  })

  // Cross-org isolation: org B's staff memory must not appear under org A's request
  it('cross-org isolation: listByStaff filters by organizationId — org B data invisible from org A', async () => {
    // The service is called with the ctx.organizationId, so if we install a service
    // that only returns data for ORG_A, org B requests get nothing.
    const svc: StaffMemoryService = {
      async read() {
        return ''
      },
      async upsert() {},
      async listByStaff({ organizationId }) {
        if (organizationId === ORG_A) return [makeEntry(AGENT_1.id, AGENT_1.name, 'A secret')]
        return []
      },
    }
    installStaffMemoryService(svc)

    // Org A gets results
    const rowsA = await staffCrossAgentMemoryOverlay.list({
      scope: makeScope(STAFF_ID),
      parentId: null,
      organizationId: ORG_A,
    })
    expect(rowsA).toHaveLength(1)

    // Org B gets nothing
    const rowsB = await staffCrossAgentMemoryOverlay.list({
      scope: makeScope(STAFF_ID),
      parentId: null,
      organizationId: ORG_B,
    })
    expect(rowsB).toEqual([])
  })

  it('returns empty when scope is not staff', async () => {
    installStaffMemoryService(stubService([makeEntry(AGENT_1.id, AGENT_1.name)]))
    const rows = await staffCrossAgentMemoryOverlay.list({
      scope: { scope: 'agent', agentId: 'some-agent' },
      parentId: null,
      organizationId: ORG_A,
    })
    expect(rows).toEqual([])
  })
})
