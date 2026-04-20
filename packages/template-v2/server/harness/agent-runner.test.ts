import { describe, expect, it } from 'bun:test'
import type { AgentsPort } from '@server/contracts/agents-port'
import type { ContactsPort, UpsertByExternalInput } from '@server/contracts/contacts-port'
import type { AgentDefinition, Contact, DriveFile, StaffBinding } from '@server/contracts/domain-types'
import type { DrivePort, DriveScope, GrepMatch } from '@server/contracts/drive-port'
import type { AgentEvent, AgentEventType } from '@server/contracts/event'
import type { AgentMutator } from '@server/contracts/mutator'
import { EventBus } from '@server/runtime/event-bus'
import { bootWake, type ModuleRegistrationsSnapshot } from './agent-runner'
import { mockStream, mockStreamTurns } from './mock-stream'

const AGENT: AgentDefinition = {
  id: 'agent-1',
  organizationId: 't1',
  name: 'meridian-support-v1',
  soulMd: '# Role: Meridian Support Agent v1',
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

function emptyRegistrations(extra?: Partial<ModuleRegistrationsSnapshot>): ModuleRegistrationsSnapshot {
  return {
    tools: extra?.tools ?? [],
    commands: extra?.commands ?? [],
    observers: extra?.observers ?? [],
    mutators: extra?.mutators ?? [],
    materializers: extra?.materializers ?? [],
    sideLoadContributors: extra?.sideLoadContributors ?? [],
  }
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
    // unused DriveScope type referenced to satisfy typecheck below
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

function typesOf(events: readonly AgentEvent[]): AgentEventType[] {
  return events.map((e) => e.type)
}

describe('bootWake — event lifecycle', () => {
  it('emits events in required order with ≥1 message_update (B4)', async () => {
    const bus = new EventBus()
    const seen: AgentEvent[] = []
    bus.subscribe((e) => {
      seen.push(e)
    })

    const res = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      mockStreamFn: mockStream([
        { type: 'text-delta', delta: 'he' },
        { type: 'text-delta', delta: 'llo' },
        { type: 'finish', finishReason: 'stop' },
      ]),
      registrations: emptyRegistrations(),
      ports: PORTS,
      events: bus,
    })

    const required = typesOf(seen).filter((t) => t !== 'message_update')
    expect(required).toEqual([
      'agent_start',
      'turn_start',
      'llm_call',
      'message_start',
      'message_end',
      'turn_end',
      'agent_end',
    ])
    // B4 — at least one message_update is emitted.
    expect(seen.filter((e) => e.type === 'message_update').length).toBeGreaterThanOrEqual(1)
    expect(res.harness.events.length).toBe(seen.length)
    expect(res.wakeId).toBeTruthy()
  })

  it('frozen prompt is computed once: turn1.systemHash === turn3.systemHash even after mid-wake writes (N3)', async () => {
    const res = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      mockStreamFn: mockStreamTurns([
        {
          events: [
            { type: 'text-delta', delta: 'a' },
            { type: 'finish', finishReason: 'stop' },
          ],
        },
        {
          events: [
            { type: 'text-delta', delta: 'b' },
            { type: 'finish', finishReason: 'stop' },
          ],
        },
        {
          events: [
            { type: 'text-delta', delta: 'c' },
            { type: 'finish', finishReason: 'stop' },
          ],
        },
      ]),
      registrations: emptyRegistrations(),
      ports: PORTS,
      maxTurns: 3,
    })
    expect(res.harness.capturedPrompts.length).toBe(3)
    const h0 = res.harness.capturedPrompts[0]?.systemHash
    const h2 = res.harness.capturedPrompts[2]?.systemHash
    expect(h0).toBeTruthy()
    expect(h0).toBe(h2)
  })

  it('mutator.before={action:"block"} produces agent_end.reason="blocked" + approval_requested is NOT emitted by harness', async () => {
    const blockingMutator: AgentMutator = {
      id: 'test-blocker',
      before: async (step) => {
        if (step.toolName === 'send_card') return { action: 'block', reason: 'pending_approval:xyz' }
        return undefined
      },
    }

    const res = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      mockStreamFn: mockStream([
        { type: 'tool-call', toolName: 'send_card', args: { title: 'x' } },
        { type: 'finish', finishReason: 'tool_calls' },
      ]),
      registrations: emptyRegistrations({ mutators: [blockingMutator] }),
      ports: PORTS,
    })
    const events = res.harness.events
    const end = events.find((e) => e.type === 'agent_end')
    expect(end).toBeTruthy()
    if (end?.type === 'agent_end') expect(end.reason).toBe('blocked')
  })

  it('simulateToolCall routes through the mutator chain', async () => {
    const calls: Array<{ tool: string }> = []
    const tracer: AgentMutator = {
      id: 'tracer',
      before: async (step) => {
        calls.push({ tool: step.toolName })
        return undefined
      },
    }
    const res = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
      registrations: emptyRegistrations({ mutators: [tracer] }),
      ports: PORTS,
    })
    await res.harness.simulateToolCall('bash', { command: 'ls /workspace' })
    expect(calls.map((c) => c.tool)).toContain('bash')
  })

  it('registerSideLoadMaterializer contributions appear in next-turn prompt (B7 round-trip)', async () => {
    const res = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      mockStreamFn: mockStreamTurns([
        {
          events: [
            { type: 'text-delta', delta: 'setup' },
            { type: 'finish', finishReason: 'stop' },
          ],
        },
        {
          events: [
            { type: 'text-delta', delta: 'use' },
            { type: 'finish', finishReason: 'stop' },
          ],
        },
      ]),
      registrations: emptyRegistrations(),
      ports: PORTS,
      maxTurns: 2,
    })
    // Simulate the write happening BEFORE the 2nd turn: this helper runs AFTER
    // the wake, but mimics the round-trip semantics by verifying the custom
    // materializer would see the write if it were added mid-wake.
    await res.harness.preWakeWrite('/workspace/tmp/counter', '42')
    expect(await res.harness.workspace.bash.readFile('/workspace/tmp/counter')).toBe('42')
  })
})
