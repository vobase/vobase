/**
 * Cross-module composition tests for the per-wake workspace pipeline.
 *
 * Validates the PR 6 contract that every per-module materializer factory and
 * `agentsMd` contributor flows through `AgentContributions<WakeContext>` and
 * surfaces the right paths/sections in the final virtual filesystem.
 *
 * These tests bypass the conversation/standalone wake builders and exercise
 * the materializer factories + AGENTS.md composition directly. The full
 * end-to-end wake assembly is exercised by the e2e suite.
 */

import { describe, expect, it } from 'bun:test'
import type { AuthLookup } from '@auth/lookup'
import { agentsAgentsMdContributors, agentsMaterializerFactory, agentsRoHints } from '@modules/agents/agent'
import type { AgentDefinition } from '@modules/agents/schema'
import { setCliRegistry } from '@modules/agents/service/cli-registry'
import { contactsAgentsMdContributors, contactsMaterializerFactory, contactsRoHints } from '@modules/contacts/agent'
import { driveAgentsMdContributors, driveMaterializerFactory, driveRoHints } from '@modules/drive/agent'
import type { FilesService } from '@modules/drive/service/files'
import { messagingAgentsMdContributors, messagingMaterializerFactory, messagingRoHints } from '@modules/messaging/agent'
import { teamAgentsMdContributors, teamMaterializerFactory } from '@modules/team/agent'
import type { AgentTool, IndexContributor, MaterializerCtx, RoHintFn, WorkspaceMaterializer } from '@vobase/core'
import { CliVerbRegistry } from '@vobase/core'

import type { WakeContext } from '../context'
import { chainRoHints } from './index'

setCliRegistry(new CliVerbRegistry())

const AGENT_ID = 'agent-comp-1'
const CONTACT_ID = 'contact-comp-1'
const CONV_ID = 'conv-comp-1'
const CHANNEL_INSTANCE_ID = 'ci-comp-1'

const MAT_CTX: MaterializerCtx = {
  organizationId: 't1',
  agentId: AGENT_ID,
  conversationId: CONV_ID,
  contactId: CONTACT_ID,
  turnIndex: 0,
}

const AGENT_DEFINITION: AgentDefinition = {
  id: AGENT_ID,
  organizationId: 't1',
  name: 'composition-agent',
  instructions: 'Test instructions.',
  model: 'mock',
  maxSteps: 4,
  workingMemory: '# Memory\n\n_empty_',
  skillAllowlist: null,
  cardApprovalRequired: false,
  fileApprovalRequired: false,
  bookSlotApprovalRequired: false,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  maxOutputTokens: null,
  maxInputTokens: null,
  maxTurnsPerWake: null,
  softCostCeilingUsd: null,
  hardCostCeilingUsd: null,
}

function makeStubAuthLookup(): AuthLookup {
  // biome-ignore lint/suspicious/useAwait: AuthLookup contract is async
  return {
    async getAuthDisplay() {
      return null
    },
  } as AuthLookup
}

function makeStubDrive(): FilesService {
  // biome-ignore lint/suspicious/useAwait: FilesService contract is async
  const notImpl = async (): Promise<never> => {
    throw new Error('stub: not implemented')
  }
  return {
    // biome-ignore lint/suspicious/useAwait: FilesService contract is async
    async get() {
      return null
    },
    // biome-ignore lint/suspicious/useAwait: FilesService contract is async
    async getByPath() {
      return null
    },
    // biome-ignore lint/suspicious/useAwait: FilesService contract is async
    async listFolder() {
      return []
    },
    // biome-ignore lint/suspicious/useAwait: FilesService contract is async
    async readContent() {
      return { content: '' }
    },
    // biome-ignore lint/suspicious/useAwait: FilesService contract is async
    async readPath() {
      return null
    },
    writePath: notImpl,
    grep: notImpl,
    create: notImpl,
    mkdir: notImpl,
    move: notImpl,
    remove: notImpl,
    // biome-ignore lint/suspicious/useAwait: FilesService contract is async
    async getBusinessMd() {
      return ''
    },
    ingestUpload: notImpl,
    saveInboundMessageAttachment: notImpl,
    deleteScope: notImpl,
  } as FilesService
}

function conversationCtx(overrides: Partial<WakeContext> = {}): WakeContext {
  return {
    organizationId: 't1',
    agentId: AGENT_ID,
    contactId: CONTACT_ID,
    channelInstanceId: CHANNEL_INSTANCE_ID,
    conversationId: CONV_ID,
    drive: makeStubDrive(),
    staffIds: [],
    authLookup: makeStubAuthLookup(),
    agentDefinition: AGENT_DEFINITION,
    tools: [],
    agentsMdContributors: [],
    ...overrides,
  }
}

function standaloneCtx(overrides: Partial<WakeContext> = {}): WakeContext {
  return {
    organizationId: 't1',
    agentId: AGENT_ID,
    conversationId: 'standalone-conv',
    drive: makeStubDrive(),
    staffIds: [],
    authLookup: makeStubAuthLookup(),
    agentDefinition: AGENT_DEFINITION,
    tools: [],
    agentsMdContributors: [],
    ...overrides,
  }
}

describe('per-module materializer factories', () => {
  it('drive factory produces /drive/BUSINESS.md regardless of lane', () => {
    const conv = driveMaterializerFactory(conversationCtx())
    const stand = driveMaterializerFactory(standaloneCtx())
    expect(conv.map((m) => m.path)).toEqual(['/drive/BUSINESS.md'])
    expect(stand.map((m) => m.path)).toEqual(['/drive/BUSINESS.md'])
  })

  it('agents factory produces /agents/<id>/AGENTS.md and MEMORY.md regardless of lane', () => {
    const conv = agentsMaterializerFactory(conversationCtx())
    const stand = agentsMaterializerFactory(standaloneCtx())
    const expected = [`/agents/${AGENT_ID}/AGENTS.md`, `/agents/${AGENT_ID}/MEMORY.md`]
    expect(conv.map((m) => m.path)).toEqual(expected)
    expect(stand.map((m) => m.path)).toEqual(expected)
  })

  it('contacts factory self-gates: emits per-contact files only when contactId is set', () => {
    const conv = contactsMaterializerFactory(conversationCtx())
    const stand = contactsMaterializerFactory(standaloneCtx())
    expect(conv.map((m) => m.path)).toEqual([`/contacts/${CONTACT_ID}/profile.md`, `/contacts/${CONTACT_ID}/MEMORY.md`])
    expect(stand).toEqual([])
  })

  it('messaging factory self-gates on contactId AND channelInstanceId', () => {
    const conv = messagingMaterializerFactory(conversationCtx())
    const stand = messagingMaterializerFactory(standaloneCtx())
    const partial = messagingMaterializerFactory(conversationCtx({ channelInstanceId: undefined }))
    expect(conv.map((m) => m.path)).toEqual([
      `/contacts/${CONTACT_ID}/${CHANNEL_INSTANCE_ID}/messages.md`,
      `/contacts/${CONTACT_ID}/${CHANNEL_INSTANCE_ID}/internal-notes.md`,
    ])
    expect(stand).toEqual([])
    expect(partial).toEqual([])
  })

  it('team factory emits two files per staffId, none when staffIds empty', () => {
    const empty = teamMaterializerFactory(conversationCtx({ staffIds: [] }))
    const some = teamMaterializerFactory(conversationCtx({ staffIds: ['s1', 's2'] }))
    expect(empty).toEqual([])
    expect(some.map((m) => m.path)).toEqual([
      '/staff/s1/profile.md',
      '/staff/s1/MEMORY.md',
      '/staff/s2/profile.md',
      '/staff/s2/MEMORY.md',
    ])
  })

  it('flatMap of all factories yields a deterministic, lane-correct path set', () => {
    const ctx = conversationCtx({ staffIds: ['s1'] })
    const factories = [
      driveMaterializerFactory,
      agentsMaterializerFactory,
      contactsMaterializerFactory,
      messagingMaterializerFactory,
      teamMaterializerFactory,
    ]
    const all: WorkspaceMaterializer[] = factories.flatMap((f) => f(ctx))
    const paths = all.map((m) => m.path)
    expect(paths).toEqual([
      '/drive/BUSINESS.md',
      `/agents/${AGENT_ID}/AGENTS.md`,
      `/agents/${AGENT_ID}/MEMORY.md`,
      `/contacts/${CONTACT_ID}/profile.md`,
      `/contacts/${CONTACT_ID}/MEMORY.md`,
      `/contacts/${CONTACT_ID}/${CHANNEL_INSTANCE_ID}/messages.md`,
      `/contacts/${CONTACT_ID}/${CHANNEL_INSTANCE_ID}/internal-notes.md`,
      '/staff/s1/profile.md',
      '/staff/s1/MEMORY.md',
    ])
  })

  it('flatMap on standalone-lane skips per-contact + per-conv paths via factory self-gating', () => {
    const ctx = standaloneCtx({ staffIds: [] })
    const factories = [
      driveMaterializerFactory,
      agentsMaterializerFactory,
      contactsMaterializerFactory,
      messagingMaterializerFactory,
      teamMaterializerFactory,
    ]
    const paths = factories.flatMap((f) => f(ctx)).map((m) => m.path)
    expect(paths).toEqual(['/drive/BUSINESS.md', `/agents/${AGENT_ID}/AGENTS.md`, `/agents/${AGENT_ID}/MEMORY.md`])
  })
})

describe('AGENTS.md composition through agentsMaterializerFactory', () => {
  function buildAllContributors(): IndexContributor[] {
    return [
      ...agentsAgentsMdContributors,
      ...driveAgentsMdContributors,
      ...contactsAgentsMdContributors,
      ...messagingAgentsMdContributors,
      ...teamAgentsMdContributors,
    ]
  }

  it('renders sections from every module in declared priority order', async () => {
    const ctx = conversationCtx({ agentsMdContributors: buildAllContributors() })
    const [m] = agentsMaterializerFactory(ctx)
    const body = await m.materialize(MAT_CTX)
    const titleIdx = body.indexOf(`# ${AGENT_DEFINITION.name} (${AGENT_ID})`)
    const selfIdx = body.indexOf('## Self-state')
    const driveIdx = body.indexOf('## Organization knowledge (drive)')
    const contactsIdx = body.indexOf('## Contact context')
    const messagingIdx = body.indexOf('## Conversation surface')
    const teamIdx = body.indexOf('## Staff')
    const instructionsIdx = body.indexOf('## Instructions')
    expect(titleIdx).toBe(0)
    expect(selfIdx).toBeGreaterThan(titleIdx)
    expect(driveIdx).toBeGreaterThan(selfIdx)
    expect(contactsIdx).toBeGreaterThan(driveIdx)
    expect(messagingIdx).toBeGreaterThan(contactsIdx)
    expect(teamIdx).toBeGreaterThan(messagingIdx)
    expect(instructionsIdx).toBeGreaterThan(teamIdx)
  })

  it('byte-stable: two consecutive materialize() calls return identical output', async () => {
    const ctx = conversationCtx({ agentsMdContributors: buildAllContributors() })
    const [m] = agentsMaterializerFactory(ctx)
    const a = await m.materialize(MAT_CTX)
    const b = await m.materialize(MAT_CTX)
    expect(a).toBe(b)
  })

  it('Tool guidance section reflects ctx.tools (lane-filtered) when tools have prompts', async () => {
    const tools: AgentTool[] = [
      // biome-ignore lint/suspicious/useAwait: AgentTool execute contract requires async signature
      {
        name: 'reply',
        description: 'reply',
        inputSchema: { type: 'object' as const },
        prompt: 'Use reply.',
        async execute() {
          return { ok: true, content: '' }
        },
      },
    ]
    const ctx = conversationCtx({ tools, agentsMdContributors: agentsAgentsMdContributors })
    const [m] = agentsMaterializerFactory(ctx)
    const body = await m.materialize(MAT_CTX)
    expect(body).toContain('## Tool guidance')
    expect(body).toContain('Use reply.')
  })

  it('omits Tool guidance section when no tool carries a prompt', async () => {
    const tools: AgentTool[] = [
      // biome-ignore lint/suspicious/useAwait: AgentTool execute contract requires async signature
      {
        name: 'reply',
        description: 'reply',
        inputSchema: { type: 'object' as const },
        async execute() {
          return { ok: true, content: '' }
        },
      },
    ]
    const ctx = conversationCtx({ tools, agentsMdContributors: agentsAgentsMdContributors })
    const [m] = agentsMaterializerFactory(ctx)
    const body = await m.materialize(MAT_CTX)
    expect(body).not.toContain('## Tool guidance')
  })

  it('falls back to "_No instructions authored yet._" when agent has no instructions', async () => {
    const ctx = conversationCtx({
      agentDefinition: { ...AGENT_DEFINITION, instructions: '' },
      agentsMdContributors: agentsAgentsMdContributors,
    })
    const [m] = agentsMaterializerFactory(ctx)
    const body = await m.materialize(MAT_CTX)
    expect(body).toContain('_No instructions authored yet._')
  })

  it('MEMORY.md materializer renders agentDefinition.workingMemory verbatim', async () => {
    const ctx = conversationCtx({
      agentDefinition: { ...AGENT_DEFINITION, workingMemory: '# Memory\n\n- Be terse' },
    })
    const [, mem] = agentsMaterializerFactory(ctx)
    const body = await mem.materialize(MAT_CTX)
    expect(body).toBe('# Memory\n\n- Be terse')
  })

  it('MEMORY.md falls back to empty stub when workingMemory is empty', async () => {
    const ctx = conversationCtx({ agentDefinition: { ...AGENT_DEFINITION, workingMemory: '' } })
    const [, mem] = agentsMaterializerFactory(ctx)
    const body = await mem.materialize(MAT_CTX)
    expect(body).toContain('# Memory')
    expect(body).toContain('_empty_')
  })
})

describe('roHints chained across modules', () => {
  it('first matching module wins; later hints do not run', () => {
    const sentinel: RoHintFn = () => 'should-never-fire'
    const chain = chainRoHints([...driveRoHints, sentinel])
    expect(chain('/drive/policies.md')).toContain('vobase drive propose')
  })

  it('falls through when earlier modules do not own the path', () => {
    const chain = chainRoHints([...driveRoHints, ...messagingRoHints, ...contactsRoHints])
    const out = chain('/contacts/c1/ci1/messages.md')
    expect(out).toContain('Read-only filesystem')
    expect(out).toContain('Use the `reply` tool')
  })

  it('returns null when no module claims the path (harness uses generic RO error)', () => {
    const chain = chainRoHints([...driveRoHints, ...messagingRoHints, ...contactsRoHints, ...agentsRoHints])
    expect(chain('/some/random/place.md')).toBeNull()
  })

  it('agents hint catches /agents/<id>/AGENTS.md', () => {
    const chain = chainRoHints([...agentsRoHints])
    const out = chain(`/agents/${AGENT_ID}/AGENTS.md`)
    expect(out).toContain('Read-only filesystem')
    expect(out).toContain('Edit the Instructions')
  })
})
