import { describe, expect, it } from 'bun:test'
import type { AuthLookup } from '@auth/lookup'
import { agentsMaterializerFactory } from '@modules/agents/agent'
import type { AgentDefinition } from '@modules/agents/schema'
import { setCliRegistry } from '@modules/agents/service/cli-registry'
import { renderContactMemory, renderContactProfile } from '@modules/contacts/agent'
import type { Contact, StaffBinding } from '@modules/contacts/schema'
import type { ContactsService, UpsertByExternalInput } from '@modules/contacts/service/contacts'
import { BUSINESS_MD_FALLBACK, driveMaterializerFactory, driveRoHints } from '@modules/drive/agent'
import type { DriveFile } from '@modules/drive/schema'
import type { FilesService } from '@modules/drive/service/files'
import type { DriveScope, GrepMatch } from '@modules/drive/service/types'
import { renderInternalNotes, renderTranscript } from '@modules/messaging/agent'
import type { MessagingPort } from '@modules/messaging/service/types'
import { CliVerbRegistry, type WorkspaceMaterializer } from '@vobase/core'

import type { WakeContext } from '../context'
import { createWorkspace } from './create'
import { buildDefaultReadOnlyConfig } from './index'

// Tests build a fresh, empty registry — `buildAgentsMaterializers` calls
// `getCliRegistry()` to render the AGENTS.md `## Commands` block. An empty
// registry produces "_No commands registered._" which is fine for these tests.
setCliRegistry(new CliVerbRegistry())

const AGENT_ID = 'agent-1'
const CONTACT_ID = 'contact-1'
const CONV_ID = 'conv-1'
const CHANNEL_INSTANCE_ID = 'ci-1'

const AGENT_DEFINITION: AgentDefinition = {
  id: AGENT_ID,
  organizationId: 't1',
  name: 'meridian-support-v1',
  instructions: '# Role: Meridian Support Agent v1\nStay on brand.',
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

function makeDriveStub(files: DriveFile[]): FilesService {
  const byId = new Map(files.map((f) => [f.id, f]))
  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async get(id) {
      return byId.get(id) ?? null
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async getByPath(scope: DriveScope, path: string) {
      for (const f of files) {
        if (f.scope !== scope.scope) continue
        if (f.path === path) return f
      }
      return null
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async listFolder(scope) {
      return files.filter((f) => f.scope === scope.scope)
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async readContent(id) {
      const f = byId.get(id)
      return { content: f?.extractedText ?? '' }
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async readPath(scope, path) {
      for (const f of files) {
        if (f.scope !== scope.scope) continue
        if (f.path === path) return { content: f.extractedText ?? '', virtual: false, file: f }
      }
      return null
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async writePath(): Promise<null> {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async grep(): Promise<GrepMatch[]> {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async create() {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async mkdir() {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async move() {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async remove() {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async getBusinessMd() {
      const biz = files.find((f) => f.scope === 'organization' && f.path === '/BUSINESS.md')
      return biz?.extractedText ?? ''
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async ingestUpload() {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async saveInboundMessageAttachment() {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async deleteScope() {
      throw new Error('not-implemented-in-phase-1')
    },
  }
}

function makeContactsStub(): ContactsService {
  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async get(id): Promise<Contact> {
      return {
        id,
        organizationId: 't1',
        displayName: 'Test Customer',
        phone: '+6580000000',
        email: null,
        profile: '',
        memory: '# Memory\n',
        attributes: {},
        segments: [],
        marketingOptOut: false,
        marketingOptOutAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async getByPhone() {
      return null
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async getByEmail() {
      return null
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async upsertByExternal(_: UpsertByExternalInput) {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async create(): Promise<Contact> {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async update(): Promise<Contact> {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async readMemory() {
      return '# Memory\n'
    },
    async upsertMemorySection() {},
    async appendMemory() {},
    async removeMemorySection() {},
    async setSegments() {},
    async setMarketingOptOut() {},
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async resolveStaffByExternal(): Promise<StaffBinding | null> {
      return null
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async bindStaff(): Promise<StaffBinding> {
      throw new Error('not-implemented-in-phase-1')
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async list(): Promise<Contact[]> {
      return []
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async remove() {
      throw new Error('not-implemented-in-phase-1')
    },
  }
}

function makeMessagingStub(): MessagingPort {
  const notImpl = (): never => {
    throw new Error('messaging stub: method not implemented')
  }
  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async listMessages() {
      return []
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async listInternalNotes() {
      return []
    },
    getConversation: notImpl,
    createConversation: notImpl,
    sendTextMessage: notImpl,
    sendCardMessage: notImpl,
    sendCardReply: notImpl,
    sendImageMessage: notImpl,
    sendMediaMessage: notImpl,
    resolve: notImpl,
    reassign: notImpl,
    reopen: notImpl,
    reset: notImpl,
    snooze: notImpl,
    unsnooze: notImpl,
    addInternalNote: notImpl,
    insertPendingApproval: notImpl,
    createInboundMessage: notImpl,
  } as MessagingPort
}

// biome-ignore lint/suspicious/useAwait: contract requires async signature
async function buildWorkspace(files: DriveFile[] = []) {
  const drive = makeDriveStub(files)
  const contacts = makeContactsStub()
  const messaging = makeMessagingStub()
  // Compose a minimal WakeContext for the agents/drive factories. Contacts
  // and messaging materializers are constructed inline from the test stubs
  // (the production factories close over real service modules; tests bypass
  // them so the stubs flow through).
  const wakeCtx: WakeContext = {
    organizationId: 't1',
    agentId: AGENT_ID,
    contactId: CONTACT_ID,
    channelInstanceId: CHANNEL_INSTANCE_ID,
    conversationId: CONV_ID,
    drive,
    staffIds: [],
    authLookup: { getAuthDisplay: async () => null } as AuthLookup,
    agentDefinition: AGENT_DEFINITION,
    tools: [],
    agentsMdContributors: [],
    lane: 'conversation',
    triggerKind: 'inbound_message',
    audienceTier: 'contact',
  }
  const contactFolder = `/contacts/${CONTACT_ID}`
  const convFolder = `/contacts/${CONTACT_ID}/${CHANNEL_INSTANCE_ID}`
  const materializers: WorkspaceMaterializer[] = [
    ...agentsMaterializerFactory(wakeCtx),
    ...driveMaterializerFactory(wakeCtx),
    {
      path: `${contactFolder}/profile.md`,
      phase: 'frozen',
      materialize: () => renderContactProfile(contacts, CONTACT_ID),
    },
    {
      path: `${contactFolder}/MEMORY.md`,
      phase: 'frozen',
      materialize: () => renderContactMemory(contacts, CONTACT_ID),
    },
    {
      path: `${convFolder}/messages.md`,
      phase: 'frozen',
      materialize: (ctx) => renderTranscript(messaging, ctx.conversationId),
    },
    {
      path: `${convFolder}/internal-notes.md`,
      phase: 'frozen',
      materialize: (ctx) => renderInternalNotes(messaging, ctx.conversationId),
    },
  ]
  return createWorkspace({
    lane: 'conversation',
    audienceTier: 'contact',
    organizationId: 't1',
    agentId: AGENT_ID,
    contactId: CONTACT_ID,
    conversationId: CONV_ID,
    channelInstanceId: CHANNEL_INSTANCE_ID,
    wakeId: 'wake-1',
    agentDefinition: AGENT_DEFINITION,
    registry: new CliVerbRegistry(),
    materializers,
    drivePort: drive,
    readOnlyConfig: buildDefaultReadOnlyConfig({
      agentId: AGENT_ID,
      contactId: CONTACT_ID,
      channelInstanceId: CHANNEL_INSTANCE_ID,
      roHints: driveRoHints,
    }),
  })
}

// biome-ignore lint/suspicious/useAwait: contract requires async signature
async function runShell(ws: Awaited<ReturnType<typeof buildWorkspace>>, cmd: string) {
  return ws.bash.exec(cmd)
}

describe('createWorkspace', () => {
  it('seeds expected directories with the unified path space', async () => {
    const ws = await buildWorkspace([
      makeTenantFile({ path: '/BUSINESS.md', extractedText: '# Meridian\n\nBrand voice.' }),
      makeTenantFile({ path: '/pricing.md', extractedText: '# Pricing' }),
    ])
    const root = await runShell(ws, 'ls /')
    expect(root.exitCode).toBe(0)
    const topNames = root.stdout.split(/\s+/u).filter(Boolean)
    for (const expected of ['agents', 'contacts', 'drive', 'tmp']) {
      expect(topNames).toContain(expected)
    }
    expect(topNames).not.toContain('conversations')

    const agentDir = await runShell(ws, `ls /agents/${AGENT_ID}`)
    const agentNames = agentDir.stdout.split(/\s+/u).filter(Boolean)
    expect(agentNames).toContain('AGENTS.md')
    expect(agentNames).toContain('MEMORY.md')
    expect(agentNames).toContain('skills')
    expect(agentNames).not.toContain('SOUL.md')
  })

  it('bash starts in /agents/<id>/ (pwd)', async () => {
    const ws = await buildWorkspace([])
    const r = await runShell(ws, 'pwd')
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim()).toBe(`/agents/${AGENT_ID}`)
  })

  it('cat /drive/BUSINESS.md returns the seeded content', async () => {
    const ws = await buildWorkspace([
      makeTenantFile({ path: '/BUSINESS.md', extractedText: '# Meridian Business\n\nBrand details.' }),
    ])
    const r = await runShell(ws, 'cat /drive/BUSINESS.md')
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('Meridian Business')
  })

  it('falls back to BUSINESS_MD_FALLBACK when the organization row is missing', async () => {
    const ws = await buildWorkspace([])
    const r = await runShell(ws, 'cat /drive/BUSINESS.md')
    expect(r.stdout).toContain('No business profile configured')
    expect(r.stdout).toContain('Ask staff to create /BUSINESS.md')
    expect(BUSINESS_MD_FALLBACK).toContain('No business profile configured')
  })

  it('rejects writes to /drive with the spec-exact EROFS error', async () => {
    const ws = await buildWorkspace([])
    const r = await runShell(ws, 'echo "x" > /drive/evil.md')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('Read-only filesystem')
    expect(r.stderr).toContain('vobase drive propose')
  })

  it('allows writes to /contacts/<id>/drive/uploads/', async () => {
    const ws = await buildWorkspace([])
    const mk = await runShell(ws, `mkdir -p /contacts/${CONTACT_ID}/drive/uploads`)
    expect(mk.exitCode).toBe(0)
    const w = await runShell(ws, `echo "hi" > /contacts/${CONTACT_ID}/drive/uploads/test.md`)
    expect(w.exitCode).toBe(0)
    const r = await runShell(ws, `cat /contacts/${CONTACT_ID}/drive/uploads/test.md`)
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim()).toBe('hi')
  })

  it('allows direct writes to agent MEMORY.md (file-as-normal-file refactor)', async () => {
    const ws = await buildWorkspace([])
    const w = await runShell(ws, `echo "lesson" > /agents/${AGENT_ID}/MEMORY.md`)
    expect(w.exitCode).toBe(0)
    const r = await runShell(ws, `cat /agents/${AGENT_ID}/MEMORY.md`)
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim()).toBe('lesson')
  })

  it('allows direct writes to contact MEMORY.md (file-as-normal-file refactor)', async () => {
    const ws = await buildWorkspace([])
    const w = await runShell(ws, `echo "note" > /contacts/${CONTACT_ID}/MEMORY.md`)
    expect(w.exitCode).toBe(0)
    const r = await runShell(ws, `cat /contacts/${CONTACT_ID}/MEMORY.md`)
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim()).toBe('note')
  })

  it('contact profile.md first line is `# <name-or-id> (<contactId>)` (identity-in-contents)', async () => {
    const ws = await buildWorkspace([])
    const r = await runShell(ws, `cat /contacts/${CONTACT_ID}/profile.md`)
    expect(r.exitCode).toBe(0)
    const firstLine = r.stdout.split('\n')[0]
    // makeContactsStub() returns displayName 'Test Customer'.
    expect(firstLine).toBe(`# Test Customer (${CONTACT_ID})`)
  })

  it('emits /contacts/<id>/<channelInstanceId>/messages.md and internal-notes.md in the virtual FS', async () => {
    const ws = await buildWorkspace([])
    const m = await runShell(ws, `cat /contacts/${CONTACT_ID}/${CHANNEL_INSTANCE_ID}/messages.md`)
    expect(m.exitCode).toBe(0)
    expect(m.stdout).toContain('No messages yet')
    const n = await runShell(ws, `cat /contacts/${CONTACT_ID}/${CHANNEL_INSTANCE_ID}/internal-notes.md`)
    expect(n.exitCode).toBe(0)
    expect(n.stdout).toContain('No notes yet')
  })
})
