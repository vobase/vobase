import { describe, expect, it } from 'bun:test'
import type { AgentsPort } from '@server/contracts/agents-port'
import type { ContactsPort, UpsertByExternalInput } from '@server/contracts/contacts-port'
import type { AgentDefinition, Contact, DriveFile, StaffBinding } from '@server/contracts/domain-types'
import type { DrivePort, DriveScope, GrepMatch } from '@server/contracts/drive-port'
import type { AgentAbortedEvent, SteerInjectedEvent } from '@server/contracts/event'
import { createSteerQueue } from '@server/runtime/steer-queue'
import { bootWake, type ModuleRegistrationsSnapshot } from './agent-runner'
import { mockStream } from './mock-stream'

// ── shared stubs (mirrors agent-runner.test.ts) ───────────────────────────────

const AGENT: AgentDefinition = {
  id: 'agent-1',
  organizationId: 't1',
  name: 'test-agent',
  soulMd: '# Role: Test',
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

function emptyDrive(): DrivePort {
  return {
    async get(): Promise<DriveFile | null> {
      return null
    },
    async getByPath() {
      return null
    },
    async listFolder() {
      return []
    },
    async readContent() {
      return { content: '' }
    },
    async grep(): Promise<GrepMatch[]> {
      return []
    },
    async create() {
      throw new Error('ni')
    },
    async mkdir() {
      throw new Error('ni')
    },
    async move() {
      throw new Error('ni')
    },
    async delete() {
      throw new Error('ni')
    },
    async ingestUpload() {
      throw new Error('ni')
    },
    async saveInboundMessageAttachment() {
      throw new Error('ni')
    },
    async deleteScope() {
      throw new Error('ni')
    },
    _scope: undefined as unknown as DriveScope,
  } as DrivePort
}

function emptyContacts(): ContactsPort {
  return {
    async get(id): Promise<Contact> {
      return {
        id,
        organizationId: 't1',
        displayName: 'Test',
        phone: null,
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
      throw new Error('ni')
    },
    async readWorkingMemory() {
      return ''
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
      throw new Error('ni')
    },
    async delete() {},
  }
}

function emptyAgents(): AgentsPort {
  return {
    async getAgentDefinition() {
      return AGENT
    },
    async appendEvent() {},
    async checkDailyCeiling() {
      return { exceeded: false, spentUsd: 0, ceilingUsd: 0 }
    },
  }
}

const PORTS = { agents: emptyAgents(), drive: emptyDrive(), contacts: emptyContacts() }

function regs(extra?: Partial<ModuleRegistrationsSnapshot>): ModuleRegistrationsSnapshot {
  return {
    tools: extra?.tools ?? [],
    commands: [],
    observers: [],
    mutators: [],
    materializers: [],
    sideLoadContributors: [],
  }
}

// ── abort tests ───────────────────────────────────────────────────────────────

describe('abort signal — pre_tool', () => {
  it('signal already aborted → no tool_execution_start, agent_aborted(pre_tool), agent_end(aborted)', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const abortCtx = { wakeAbort: ctrl, reason: 'user-cancel' }

    const { harness } = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      abortCtx,
      registrations: regs(),
      ports: PORTS,
      mockStreamFn: mockStream([
        { type: 'tool-call', toolName: 'bash', toolCallId: 'tc1', args: { command: 'echo hi' } },
        { type: 'finish', finishReason: 'tool_calls' },
      ]),
    })

    const types = harness.events.map((e) => e.type)
    expect(types).not.toContain('tool_execution_start')
    expect(types).toContain('agent_aborted')

    const abortedEvt = harness.events.find((e) => e.type === 'agent_aborted') as AgentAbortedEvent
    expect(abortedEvt.abortedAt).toBe('pre_tool')
    expect(abortedEvt.reason).toBe('user-cancel')

    const endEvt = harness.events.find((e) => e.type === 'agent_end') as { reason: string }
    expect(endEvt.reason).toBe('aborted')
  })
})

describe('abort signal — in_tool', () => {
  it('signal aborted inside tool.execute → tool_execution_end still emitted, agent_aborted(in_tool)', async () => {
    const ctrl = new AbortController()
    const abortCtx = { wakeAbort: ctrl, reason: 'external' }

    const toolThatAborts = {
      name: 'bash',
      description: 'test',
      parallelGroup: 'never' as const,
      inputSchema: { type: 'object' as const, properties: {}, required: [] },
      execute: async () => {
        ctrl.abort()
        return { ok: true as const, content: { stdout: 'done', stderr: '', exitCode: 0 } }
      },
    }

    const { harness } = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      abortCtx,
      registrations: regs({ tools: [toolThatAborts] }),
      ports: PORTS,
      mockStreamFn: mockStream([
        { type: 'tool-call', toolName: 'bash', toolCallId: 'tc1', args: { command: 'echo a' } },
        { type: 'tool-call', toolName: 'bash', toolCallId: 'tc2', args: { command: 'echo b' } },
        { type: 'finish', finishReason: 'tool_calls' },
      ]),
    })

    // First tool ran to completion
    const starts = harness.events.filter((e) => e.type === 'tool_execution_start')
    expect(starts).toHaveLength(1)
    expect(harness.events.some((e) => e.type === 'tool_execution_end')).toBe(true)

    const abortedEvt = harness.events.find((e) => e.type === 'agent_aborted') as AgentAbortedEvent
    expect(abortedEvt.abortedAt).toBe('in_tool')

    const endEvt = harness.events.find((e) => e.type === 'agent_end') as { reason: string }
    expect(endEvt.reason).toBe('aborted')
  })
})

describe('abort signal — no abort', () => {
  it('no abort → no agent_aborted, agent_end(complete)', async () => {
    const { harness } = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      registrations: regs(),
      ports: PORTS,
      mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
    })

    const types = harness.events.map((e) => e.type)
    expect(types).not.toContain('agent_aborted')
    const endEvt = harness.events.find((e) => e.type === 'agent_end') as { reason: string }
    expect(endEvt.reason).toBe('complete')
  })
})

// ── steer queue tests ─────────────────────────────────────────────────────────

describe('steer queue', () => {
  it('steer pushed before wake → injected at turn 1 as steer_injected', async () => {
    const steerQueue = createSteerQueue()
    steerQueue.push('Focus on refund.')

    const { harness } = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      maxTurns: 2,
      steerQueue,
      registrations: regs(),
      ports: PORTS,
      mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
    })

    const steerEvts = harness.events.filter((e) => e.type === 'steer_injected') as SteerInjectedEvent[]
    expect(steerEvts).toHaveLength(1)
    expect(steerEvts[0].text).toBe('Focus on refund.')
    expect(steerEvts[0].turnIndex).toBe(1)
  })

  it('steer text prepended to capturedPrompts[1].firstUserMessage', async () => {
    const steerQueue = createSteerQueue()
    steerQueue.push('URGENT: wrap up.')

    const { harness } = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      maxTurns: 2,
      steerQueue,
      registrations: regs(),
      ports: PORTS,
      mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
    })

    expect(harness.capturedPrompts[1].firstUserMessage).toContain('URGENT: wrap up.')
  })

  it('no steer pushed → no steer_injected event', async () => {
    const steerQueue = createSteerQueue()

    const { harness } = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      maxTurns: 2,
      steerQueue,
      registrations: regs(),
      ports: PORTS,
      mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
    })

    const types = harness.events.map((e) => e.type)
    expect(types).not.toContain('steer_injected')
  })
})
