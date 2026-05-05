import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { AgentDefinition } from '@modules/agents/schema'
import type { Contact } from '@modules/contacts/schema'
import {
  __resetContactsServiceForTests,
  type ContactsService,
  installContactsService,
} from '@modules/contacts/service/contacts'
import type { MaterializerCtx, WorkspaceMaterializer } from '@vobase/core'

import type { WakeContext } from '~/wake/context'
import { contactsMaterializerFactory } from './agent'

const MAT_CTX: MaterializerCtx = {
  organizationId: 'org_test',
  agentId: 'a_test',
  conversationId: 'conv_test',
  contactId: 'c_test',
  turnIndex: 0,
}

function makeContactsStub(memoryByContact: Record<string, string>): ContactsService {
  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async get(id: string) {
      return {
        id,
        organizationId: 'org_test',
        displayName: `Contact ${id}`,
        phone: null,
        email: null,
        memory: memoryByContact[id] ?? '',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      } as unknown as Contact
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async readMemory(id: string) {
      return memoryByContact[id] ?? ''
    },
  } as unknown as ContactsService
}

function makeWakeCtx(overrides: Partial<WakeContext> = {}): WakeContext {
  const agentDefinition = {
    id: 'a_test',
    organizationId: 'org_test',
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
    organizationId: 'org_test',
    agentId: 'a_test',
    contactId: 'c_test',
    channelInstanceId: 'ci_test',
    conversationId: 'conv_test',
    drive: {} as WakeContext['drive'],
    staffIds: [],
    budgetHeaderStaffIds: [],
    authLookup: {} as WakeContext['authLookup'],
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

describe('contact materializer header', () => {
  beforeAll(() => {
    installContactsService(makeContactsStub({ c_test: '# Memory\n\n- prefers bank transfer\n' }))
  })

  afterAll(() => {
    __resetContactsServiceForTests()
  })

  it('prepends a memory-budget header to /contacts/<id>/MEMORY.md when memory is non-empty', async () => {
    const ctx = makeWakeCtx()
    const mats = contactsMaterializerFactory(ctx)
    const memMat = mats.find((m) => m.path === `/contacts/${ctx.contactId}/MEMORY.md`)
    expect(memMat).toBeDefined()
    if (!memMat) return
    const out = await runMaterializer(memMat)
    expect(out).toMatch(
      /^<!-- memory-budget scope=contact id=c_test chars=\d+ \(utf16\) cap=8000 over=(true|false) -->\n/,
    )
    expect(out).toContain('prefers bank transfer')
  })

  it('still emits the header when contact memory is empty (falls back to empty-memory stub body)', async () => {
    installContactsService(makeContactsStub({}))
    const ctx = makeWakeCtx({ contactId: 'c_empty' })
    const mats = contactsMaterializerFactory(ctx)
    const memMat = mats.find((m) => m.path === `/contacts/${ctx.contactId}/MEMORY.md`)
    expect(memMat).toBeDefined()
    if (!memMat) return
    const out = await runMaterializer(memMat)
    expect(out.startsWith('<!-- memory-budget scope=contact id=c_empty chars=')).toBe(true)
    expect(out).toContain('cap=8000')
    // restore for subsequent tests
    installContactsService(makeContactsStub({ c_test: '# Memory\n\n- prefers bank transfer\n' }))
  })

  it('two same-input calls produce byte-identical output', async () => {
    const ctx = makeWakeCtx()
    const mats1 = contactsMaterializerFactory(ctx)
    const mats2 = contactsMaterializerFactory(ctx)
    const m1 = mats1.find((m) => m.path === `/contacts/${ctx.contactId}/MEMORY.md`)
    const m2 = mats2.find((m) => m.path === `/contacts/${ctx.contactId}/MEMORY.md`)
    expect(m1 && m2).toBeTruthy()
    if (!m1 || !m2) return
    const a = await runMaterializer(m1)
    const b = await runMaterializer(m2)
    expect(a).toBe(b)
  })
})
