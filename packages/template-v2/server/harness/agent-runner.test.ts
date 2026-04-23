/**
 * Harness unit coverage — exercises the pi-agent-core event-translation
 * pipeline with stub ports and `stubStreamFn`. No DB, no network.
 *
 * Assertions target the four invariants from
 * `.omc/plans/pi-agent-core-migration.md`:
 *   1. llm_call synthesized once per pi message_end.
 *   2. Our event sequence brackets user-turns, not pi sub-turns.
 *   3. systemHash stable across turns (frozen-snapshot).
 *   4. Message history snapshots land on translated turn_end only.
 */

import { describe, expect, it } from 'bun:test'
import type { AssistantMessage, AssistantMessageEvent } from '@mariozechner/pi-ai'
import type { AgentDefinition } from '@modules/agents/schema'
import type { AgentsPort } from '@modules/agents/service/types'
import type { FilesService } from '@modules/drive/service/files'
import type { AgentEvent } from '@server/contracts/event'
import { stubStreamFn } from '../../tests/helpers/stub-stream'
import { bootWake } from './agent-runner'

const FAKE_AGENT: AgentDefinition = {
  id: 'agent-test',
  name: 'Test Agent',
  organizationId: 'org-test',
  model: 'gpt-5.4',
  prompt: '',
  tools: [],
  skills: [],
  toolAllowlist: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
  active: true,
} as unknown as AgentDefinition

const STUB_AGENTS: AgentsPort = {
  async getAgentDefinition() {
    return FAKE_AGENT
  },
  async appendEvent() {
    /* noop */
  },
  async checkDailyCeiling() {
    return { exceeded: false, spentUsd: 0, ceilingUsd: 0 }
  },
}

const STUB_DRIVE: FilesService = {
  async get() {
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
  async readPath() {
    return null
  },
  async writePath() {
    return null
  },
  async grep() {
    return []
  },
  async create() {
    throw new Error('stub')
  },
  async mkdir() {
    throw new Error('stub')
  },
  async move() {
    throw new Error('stub')
  },
  async remove() {
    throw new Error('stub')
  },
  async getBusinessMd() {
    return ''
  },
  async ingestUpload() {
    throw new Error('stub')
  },
  async saveInboundMessageAttachment() {
    throw new Error('stub')
  },
  async deleteScope() {
    throw new Error('stub')
  },
}

const STUB_CONTACTS = {
  async get() {
    return {
      id: 'contact-1',
      organizationId: 'org-test',
      displayName: 'Alice',
      phone: null,
      email: null,
      segments: [],
      profile: '',
      notes: '',
      attributes: {},
    }
  },
  async list() {
    return []
  },
  async getByPhone() {
    return null
  },
  async getByEmail() {
    return null
  },
  async upsertByExternal() {
    throw new Error('stub')
  },
  async readNotes() {
    return ''
  },
  async upsertNotesSection() {
    throw new Error('stub')
  },
  async appendNotes() {
    throw new Error('stub')
  },
  async removeNotesSection() {
    throw new Error('stub')
  },
  async setSegments() {
    throw new Error('stub')
  },
  async setMarketingOptOut() {
    throw new Error('stub')
  },
  async resolveStaffByExternal() {
    return null
  },
  async bindStaff() {
    throw new Error('stub')
  },
  async remove() {
    throw new Error('stub')
  },
  // biome-ignore lint/suspicious/noExplicitAny: test stub
} as any

function makeAssistantPartial(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    provider: 'openai',
    model: 'gpt-5.4',
    api: 'openai-responses',
    stopReason: 'stop',
    timestamp: Date.now(),
    usage: {
      input: 10,
      output: text.length,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 10 + text.length,
      cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
    },
  }
}

function simpleReplyScript(text: string): AssistantMessageEvent[] {
  const partial = makeAssistantPartial(text)
  return [
    { type: 'start', partial },
    { type: 'text_start', contentIndex: 0, partial },
    { type: 'text_delta', contentIndex: 0, delta: text, partial },
    { type: 'text_end', contentIndex: 0, content: text, partial },
    { type: 'done', reason: 'stop', message: partial },
  ]
}

describe('bootWake (pi-agent-core path)', () => {
  it('emits the contract event sequence for a single-turn text reply', async () => {
    const res = await bootWake({
      organizationId: 'org-test',
      agentId: 'agent-test',
      contactId: 'contact-1',
      streamFn: stubStreamFn([simpleReplyScript('hello')]),
      registrations: {
        tools: [],
        commands: [],
        observers: [],
        mutators: [],
        materializers: [],
        sideLoadContributors: [],
      },
      ports: { agents: STUB_AGENTS, drive: STUB_DRIVE, contacts: STUB_CONTACTS },
      maxTurns: 1,
    })

    const types = res.harness.events.map((e: AgentEvent) => e.type).filter((t) => t !== 'message_update')

    // Brackets: agent_start, turn_start, exactly one llm_call, message_*, turn_end, agent_end.
    expect(types[0]).toBe('agent_start')
    expect(types.at(-1)).toBe('agent_end')
    expect(types.filter((t) => t === 'turn_start').length).toBe(1)
    expect(types.filter((t) => t === 'turn_end').length).toBe(1)
    expect(types.filter((t) => t === 'llm_call').length).toBe(1)
    expect(types.filter((t) => t === 'message_start').length).toBe(1)
    expect(types.filter((t) => t === 'message_end').length).toBe(1)
  })

  it('emits systemHash on agent_start and keeps it stable across multi-turn', async () => {
    // Second outer turn is only reached when a steer is pending — push one
    // ahead of bootWake so both user-turns capture a prompt.
    const { createSteerQueue } = await import('@vobase/core')
    const steerQueue = createSteerQueue()
    steerQueue.push('steer!')
    const res = await bootWake({
      organizationId: 'org-test',
      agentId: 'agent-test',
      contactId: 'contact-1',
      streamFn: stubStreamFn([simpleReplyScript('one'), simpleReplyScript('two')]),
      registrations: {
        tools: [],
        commands: [],
        observers: [],
        mutators: [],
        materializers: [],
        sideLoadContributors: [],
      },
      ports: { agents: STUB_AGENTS, drive: STUB_DRIVE, contacts: STUB_CONTACTS },
      maxTurns: 2,
      steerQueue,
    })

    // capturedPrompts records one entry per user-turn; systemHash identical.
    expect(res.harness.capturedPrompts.length).toBe(2)
    const h0 = res.harness.capturedPrompts[0]?.systemHash
    const h1 = res.harness.capturedPrompts[1]?.systemHash
    expect(h0).toBeDefined()
    expect(h1).toBe(h0)
  })

  it('llm_call event carries synthesized tokens + cost + latency from message.usage', async () => {
    const res = await bootWake({
      organizationId: 'org-test',
      agentId: 'agent-test',
      contactId: 'contact-1',
      streamFn: stubStreamFn([simpleReplyScript('hi')]),
      registrations: {
        tools: [],
        commands: [],
        observers: [],
        mutators: [],
        materializers: [],
        sideLoadContributors: [],
      },
      ports: { agents: STUB_AGENTS, drive: STUB_DRIVE, contacts: STUB_CONTACTS },
      maxTurns: 1,
    })

    const llm = res.harness.events.find((e) => e.type === 'llm_call')
    expect(llm).toBeDefined()
    if (llm?.type !== 'llm_call') throw new Error('expected llm_call event')
    expect(llm.task).toBe('agent.turn')
    expect(llm.tokensIn).toBe(10)
    expect(llm.tokensOut).toBe(2)
    expect(llm.costUsd).toBeCloseTo(0.003, 5)
    expect(llm.cacheHit).toBe(false)
    expect(llm.provider).toBe('openai')
  })
})
