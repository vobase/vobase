import { describe, expect, it } from 'bun:test'
import type { AgentsPort } from '@server/contracts/agents-port'
import type { ContactsPort, UpsertByExternalInput } from '@server/contracts/contacts-port'
import type { AgentDefinition, Contact, DriveFile, StaffBinding } from '@server/contracts/domain-types'
import type { DrivePort, DriveScope, GrepMatch } from '@server/contracts/drive-port'
import { BUSINESS_MD_FALLBACK, createWorkspace } from './create-workspace'

const AGENT_DEFINITION: AgentDefinition = {
  id: 'agent-1',
  organizationId: 't1',
  name: 'meridian-support-v1',
  soulMd: '# Role: Meridian Support Agent v1\nStay on brand.',
  model: 'mock',
  maxSteps: 4,
  workingMemory: '# Memory\n\n_empty_',
  skillAllowlist: null,
  cardApprovalRequired: true,
  fileApprovalRequired: false,
  bookSlotApprovalRequired: true,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  maxOutputTokens: null,
  maxInputTokens: null,
  maxTurnsPerWake: null,
  softCostCeilingUsd: null,
  hardCostCeilingUsd: null,
}

function makeTenantFile(partial: Partial<DriveFile> & { path: string; extractedText: string }): DriveFile {
  const id = partial.id ?? `f-${partial.path}`
  return {
    id,
    organizationId: 't1',
    scope: 'organization',
    scopeId: 't1',
    parentFolderId: null,
    kind: 'file',
    name: partial.path.split('/').pop() ?? 'unnamed',
    path: partial.path,
    mimeType: 'text/markdown',
    sizeBytes: partial.extractedText.length,
    storageKey: null,
    caption: null,
    captionModel: null,
    captionUpdatedAt: null,
    extractedText: partial.extractedText,
    source: null,
    sourceMessageId: null,
    tags: [],
    uploadedBy: null,
    processingStatus: 'ready',
    processingError: null,
    threatScanReport: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function makeDriveStub(files: DriveFile[]): DrivePort {
  const byId = new Map(files.map((f) => [f.id, f]))
  return {
    async get(id) {
      return byId.get(id) ?? null
    },
    async getByPath(scope: DriveScope, path: string) {
      for (const f of files) {
        if (f.scope !== scope.scope) continue
        if (f.path === path) return f
      }
      return null
    },
    async listFolder(scope) {
      return files.filter((f) => f.scope === scope.scope)
    },
    async readContent(id) {
      const f = byId.get(id)
      return { content: f?.extractedText ?? '' }
    },
    async grep(): Promise<GrepMatch[]> {
      throw new Error('not-implemented-in-phase-1')
    },
    async create() {
      throw new Error('not-implemented-in-phase-1')
    },
    async mkdir() {
      throw new Error('not-implemented-in-phase-1')
    },
    async move() {
      throw new Error('not-implemented-in-phase-1')
    },
    async delete() {
      throw new Error('not-implemented-in-phase-1')
    },
    async ingestUpload() {
      throw new Error('not-implemented-in-phase-1')
    },
    async saveInboundMessageAttachment() {
      throw new Error('not-implemented-in-phase-1')
    },
    async deleteScope() {
      throw new Error('not-implemented-in-phase-1')
    },
  }
}

function makeContactsStub(): ContactsPort {
  return {
    async get(id): Promise<Contact> {
      return {
        id,
        organizationId: 't1',
        displayName: 'Test Customer',
        phone: '+6580000000',
        email: null,
        workingMemory: '# Memory\n',
        segments: [],
        marketingOptOut: false,
        marketingOptOutAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    },
    async getByPhone() {
      return null
    },
    async getByEmail() {
      return null
    },
    async upsertByExternal(_: UpsertByExternalInput) {
      throw new Error('not-implemented-in-phase-1')
    },
    async readWorkingMemory() {
      return '# Memory\n'
    },
    async upsertWorkingMemorySection() {},
    async appendWorkingMemory() {},
    async removeWorkingMemorySection() {},
    async setSegments() {},
    async setMarketingOptOut() {},
    async resolveStaffByExternal(): Promise<StaffBinding | null> {
      return null
    },
    async bindStaff(): Promise<StaffBinding> {
      throw new Error('not-implemented-in-phase-1')
    },
    async delete() {
      throw new Error('not-implemented-in-phase-1')
    },
  }
}

function makeAgentsStub(): AgentsPort {
  return {
    async getAgentDefinition() {
      return AGENT_DEFINITION
    },
    async appendEvent() {},
    async checkDailyCeiling() {
      return { exceeded: false, spentUsd: 0, ceilingUsd: 0 }
    },
  }
}

async function buildWorkspace(files: DriveFile[] = []) {
  return createWorkspace({
    organizationId: 't1',
    agentId: 'agent-1',
    contactId: 'contact-1',
    conversationId: 'conv-1',
    wakeId: 'wake-1',
    agentDefinition: AGENT_DEFINITION,
    commands: [],
    materializers: [],
    drivePort: makeDriveStub(files),
    contactsPort: makeContactsStub(),
    agentsPort: makeAgentsStub(),
  })
}

async function run(ws: Awaited<ReturnType<typeof buildWorkspace>>, cmd: string) {
  return ws.bash.exec(cmd)
}

describe('createWorkspace', () => {
  it('seeds the expected 8 eager paths and ls lists them', async () => {
    const ws = await buildWorkspace([
      makeTenantFile({ path: '/BUSINESS.md', extractedText: '# Meridian\n\nBrand voice.' }),
      makeTenantFile({ path: '/pricing.md', extractedText: '# Pricing' }),
    ])
    const res = await run(ws, 'ls /workspace')
    expect(res.exitCode).toBe(0)
    const names = res.stdout.split(/\s+/u).filter(Boolean)
    for (const expected of ['AGENTS.md', 'SOUL.md', 'MEMORY.md', 'skills', 'drive', 'conversation', 'contact', 'tmp']) {
      expect(names).toContain(expected)
    }
  })

  it('cat /workspace/drive/BUSINESS.md returns the seeded content', async () => {
    const ws = await buildWorkspace([
      makeTenantFile({ path: '/BUSINESS.md', extractedText: '# Meridian Business\n\nBrand details.' }),
    ])
    const r = await run(ws, 'cat /workspace/drive/BUSINESS.md')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('Meridian Business')
  })

  it('falls back to BUSINESS_MD_FALLBACK when the organization row is missing (R8)', async () => {
    const ws = await buildWorkspace([])
    const r = await run(ws, 'cat /workspace/drive/BUSINESS.md')
    expect(r.stdout).toContain('No business profile configured')
    expect(r.stdout).toContain('Ask staff to create /BUSINESS.md')
    expect(BUSINESS_MD_FALLBACK).toContain('No business profile configured')
  })

  it('rejects writes to /workspace/drive with the spec-exact EROFS error', async () => {
    const ws = await buildWorkspace([])
    const r = await run(ws, 'echo "x" > /workspace/drive/evil.md')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('Read-only filesystem')
    expect(r.stderr).toContain('vobase drive propose')
  })

  it('allows writes to /workspace/contact/drive/uploads/', async () => {
    const ws = await buildWorkspace([])
    const mk = await run(ws, 'mkdir -p /workspace/contact/drive/uploads')
    expect(mk.exitCode).toBe(0)
    const w = await run(ws, 'echo "hi" > /workspace/contact/drive/uploads/test.md')
    expect(w.exitCode).toBe(0)
    const r = await run(ws, 'cat /workspace/contact/drive/uploads/test.md')
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim()).toBe('hi')
  })

  it('rejects direct writes to MEMORY.md with the vobase memory hint', async () => {
    const ws = await buildWorkspace([])
    const r = await run(ws, 'echo "x" > /workspace/MEMORY.md')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('vobase memory set|append|remove')
  })
})
