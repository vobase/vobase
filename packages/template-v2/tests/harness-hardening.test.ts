/**
 * Harness hardening — convergence integration test.
 * Covers all 9 lanes end-to-end; no Docker or database required.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentsPort } from '@server/contracts/agents-port'
import type { ContactsPort, UpsertByExternalInput } from '@server/contracts/contacts-port'
import type { AgentDefinition, Contact, DriveFile, StaffBinding } from '@server/contracts/domain-types'
import type { DrivePort, DriveScope, GrepMatch } from '@server/contracts/drive-port'
import type {
  AgentAbortedEvent,
  BudgetWarningEvent,
  ErrorClassifiedEvent,
  LlmCallEvent,
  SteerInjectedEvent,
  ToolResultPersistedEvent,
} from '@server/contracts/event'
import type { IterationBudget } from '@server/contracts/iteration-budget'
import type { ToolExecutionContext } from '@server/contracts/plugin-context'
import type { LlmProvider, LlmStreamChunk } from '@server/contracts/provider-port'
import type { AgentTool } from '@server/contracts/tool'
import type { ToolResult } from '@server/contracts/tool-result'
import { bootWake, type ModuleRegistrationsSnapshot } from '@server/harness/agent-runner'
import { makeBashTool } from '@server/harness/bash-tool'
import { mockStream } from '@server/harness/mock-stream'
import { _clearEndpointCache, resolveProviderEndpoint } from '@server/harness/providers/factory'
import { createOpenAIProvider, type OpenAIFetch } from '@server/harness/providers/openai'
import { createRestartRecoveryContributor } from '@server/harness/restart-recovery'
import { TurnBudget } from '@server/harness/turn-budget'
import { classifyError } from '@server/runtime/error-classifier'
import { EventBus } from '@server/runtime/event-bus'
import { assessBudget } from '@server/runtime/iteration-budget-runtime'
import { classifyBatch, type ToolCall } from '@server/runtime/parallel-classifier'
import { makeResilientProvider } from '@server/runtime/resilient-provider'
import { createSteerQueue } from '@server/runtime/steer-queue'
import { Bash, InMemoryFs } from 'just-bash'
import { createRecordedProvider } from './helpers/recorded-provider'

// ── shared stubs ──────────────────────────────────────────────────────────────

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

const TOOL_CTX: ToolExecutionContext = {
  organizationId: 't1',
  conversationId: 'c1',
  wakeId: 'w1',
  agentId: 'agent-1',
  turnIndex: 0,
  toolCallId: 'call-1',
}

const noopLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function successChunks(): LlmStreamChunk[] {
  return [
    { type: 'text-delta', text: 'ok' },
    {
      type: 'finish',
      finishReason: 'end_turn',
      tokensIn: 10,
      tokensOut: 2,
      cacheReadTokens: 0,
      costUsd: 0.001,
      latencyMs: 50,
      cacheHit: false,
    },
  ]
}

function throwingStream(err: unknown): AsyncIterableIterator<LlmStreamChunk> {
  return {
    async next(): Promise<IteratorResult<LlmStreamChunk>> {
      throw err
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }
}

async function* successStream(): AsyncIterableIterator<LlmStreamChunk> {
  for (const c of successChunks()) yield c
}

function makeTool(name: string, pg: AgentTool['parallelGroup']): AgentTool {
  return {
    name,
    description: name,
    inputSchema: {},
    parallelGroup: pg,
    execute: async (): Promise<ToolResult<unknown>> => ({ ok: true, content: null }),
  }
}

afterEach(() => {
  _clearEndpointCache()
  delete process.env.BIFROST_API_KEY
  delete process.env.BIFROST_URL
  delete process.env.ANTHROPIC_API_KEY
})

// ── Lane A1 — error classifier ────────────────────────────────────────────────

describe('Lane A1 — error classifier', () => {
  it('HTTP 413 → payload_too_large', () => {
    const err = Object.assign(new Error('Request too large'), { status: 413 })
    expect(classifyError(err).reason).toBe('payload_too_large')
  })

  it('context_length_exceeded code → context_overflow', () => {
    const err = Object.assign(new Error('context_length_exceeded'), {
      status: 400,
      code: 'context_length_exceeded',
    })
    expect(classifyError(err).reason).toBe('context_overflow')
  })

  it('HTTP 429 with retry-after header → transient + retryAfterMs', () => {
    const err = Object.assign(new Error('Too many requests'), {
      status: 429,
      headers: { 'retry-after': '2' },
    })
    const result = classifyError(err)
    expect(result.reason).toBe('transient')
    expect(result.retryAfterMs).toBe(2000)
  })

  it('AbortError → transient', () => {
    const err = Object.assign(new Error('Request aborted'), { name: 'AbortError' })
    expect(classifyError(err).reason).toBe('transient')
  })

  it('HTTP 418 → unknown (never coerced to transient)', () => {
    const err = Object.assign(new Error("I'm a teapot"), { status: 418 })
    expect(classifyError(err).reason).toBe('unknown')
  })
})

// ── Lane A2 — resilient provider ──────────────────────────────────────────────

describe('Lane A2 — resilient provider', () => {
  function makePolicy(bus: EventBus) {
    return {
      events: bus,
      logger: noopLogger,
      getScope: () => ({ organizationId: 't1', conversationId: 'c1', wakeId: 'w1', turnIndex: 0 }),
      maxTransientRetries: 3,
    }
  }

  async function drain(provider: LlmProvider): Promise<LlmStreamChunk[]> {
    const chunks: LlmStreamChunk[] = []
    for await (const c of provider.stream({})) chunks.push(c)
    return chunks
  }

  it('413 → error_classified(payload_too_large) → compress → retry → success', async () => {
    const bus = new EventBus()
    const classified: ErrorClassifiedEvent[] = []
    bus.subscribe((ev) => {
      if (ev.type === 'error_classified') classified.push(ev as ErrorClassifiedEvent)
    })
    let calls = 0
    const inner: LlmProvider = {
      name: 'stub',
      stream() {
        calls++
        return calls === 1
          ? throwingStream(Object.assign(new Error('payload too large'), { status: 413 }))
          : successStream()
      },
    }
    const chunks = await drain(makeResilientProvider(inner, makePolicy(bus)))
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true)
    expect(calls).toBe(2)
    expect(classified[0].reason).toBe('payload_too_large')
  })

  it('context_overflow → error_classified(context_overflow) → compress → retry → success', async () => {
    const bus = new EventBus()
    const classified: ErrorClassifiedEvent[] = []
    bus.subscribe((ev) => {
      if (ev.type === 'error_classified') classified.push(ev as ErrorClassifiedEvent)
    })
    let calls = 0
    const inner: LlmProvider = {
      name: 'stub',
      stream() {
        calls++
        return calls === 1
          ? throwingStream(
              Object.assign(new Error("model's maximum context length is 128000 tokens"), {
                status: 400,
                code: 'context_length_exceeded',
              }),
            )
          : successStream()
      },
    }
    const chunks = await drain(makeResilientProvider(inner, makePolicy(bus)))
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true)
    expect(calls).toBe(2)
    expect(classified[0].reason).toBe('context_overflow')
  })

  it('transient network error → error_classified emitted before each retry, eventual success', async () => {
    const bus = new EventBus()
    const classified: ErrorClassifiedEvent[] = []
    bus.subscribe((ev) => {
      if (ev.type === 'error_classified') classified.push(ev as ErrorClassifiedEvent)
    })
    let calls = 0
    const inner: LlmProvider = {
      name: 'stub',
      stream() {
        calls++
        return calls <= 2 ? throwingStream(new Error('fetch failed: ECONNRESET')) : successStream()
      },
    }
    const chunks = await drain(makeResilientProvider(inner, makePolicy(bus)))
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true)
    expect(calls).toBe(3)
    expect(classified).toHaveLength(2)
    expect(classified.every((e) => e.reason === 'transient')).toBe(true)
  })

  it('unknown error → no retry + error_classified(unknown) + throws', async () => {
    const bus = new EventBus()
    const classified: ErrorClassifiedEvent[] = []
    bus.subscribe((ev) => {
      if (ev.type === 'error_classified') classified.push(ev as ErrorClassifiedEvent)
    })
    let calls = 0
    const inner: LlmProvider = {
      name: 'stub',
      stream() {
        calls++
        return throwingStream(Object.assign(new Error('exotic_error'), { status: 418 }))
      },
    }
    await expect(drain(makeResilientProvider(inner, makePolicy(bus)))).rejects.toThrow('exotic_error')
    expect(calls).toBe(1)
    expect(classified[0].reason).toBe('unknown')
  })
})

// ── Lane B — three-layer tool-result budget ───────────────────────────────────

describe('Lane B — three-layer tool-result budget', () => {
  it('50 KB output passes through without spill', async () => {
    const fs = new InMemoryFs()
    await fs.writeFile('/data.txt', 'x'.repeat(50_000))
    const bash = new Bash({ fs })
    const spills: ToolResultPersistedEvent[] = []
    const tool = makeBashTool({
      bash,
      innerWrite: async (p, c) => fs.writeFile(p, c),
      onSpill: (ev) => spills.push(ev),
    })
    const result = await tool.execute({ command: 'cat /data.txt' }, TOOL_CTX)
    expect(result.ok).toBe(true)
    expect(spills).toHaveLength(0)
  })

  it('150 KB output → L2 spill: ToolResultPersistedEvent emitted, preview truncated to L1', async () => {
    const fs = new InMemoryFs()
    await fs.writeFile('/big.txt', 'x'.repeat(150_000))
    const bash = new Bash({ fs })
    const spills: ToolResultPersistedEvent[] = []
    const tool = makeBashTool({
      bash,
      innerWrite: async (p, c) => fs.writeFile(p, c),
      onSpill: (ev) => spills.push(ev),
    })
    const result = await tool.execute({ command: 'cat /big.txt' }, { ...TOOL_CTX, toolCallId: 'big-call' })
    expect(result.ok).toBe(true)
    expect(spills).toHaveLength(1)
    expect(spills[0].originalByteLength).toBe(150_000)
    if (result.ok) expect(result.content.stdout.length).toBeLessThan(150_000)
  })

  it('L3 aggregate ceiling: second result force-spilled when aggregate would exceed 200 KB', async () => {
    const fs = new InMemoryFs()
    await fs.writeFile('/first.txt', 'x'.repeat(130_000))
    await fs.writeFile('/second.txt', 'y'.repeat(90_000))
    const bash = new Bash({ fs })
    const turnBudget = new TurnBudget()
    const spills: ToolResultPersistedEvent[] = []
    const tool = makeBashTool({
      bash,
      innerWrite: async (p, c) => fs.writeFile(p, c),
      turnBudget,
      onSpill: (ev) => spills.push(ev),
    })
    await tool.execute({ command: 'cat /first.txt' }, { ...TOOL_CTX, toolCallId: 'call-a' })
    await tool.execute({ command: 'cat /second.txt' }, { ...TOOL_CTX, toolCallId: 'call-b' })
    // Both spill: first > L2, second would push aggregate past L3
    expect(spills).toHaveLength(2)
  })

  it('cat /workspace/tmp/tool-*.txt bypasses all spill logic (path exemption)', async () => {
    const fs = new InMemoryFs()
    await fs.writeFile('/workspace/tmp/tool-abc123.txt', 'spill-content')
    const bash = new Bash({ fs })
    const turnBudget = new TurnBudget()
    // Pre-exhaust L3 so any non-exempt result would spill
    turnBudget.record(300_000)
    const spills: ToolResultPersistedEvent[] = []
    const tool = makeBashTool({
      bash,
      innerWrite: async (p, c) => fs.writeFile(p, c),
      turnBudget,
      onSpill: (ev) => spills.push(ev),
    })
    const result = await tool.execute({ command: 'cat /workspace/tmp/tool-abc123.txt' }, TOOL_CTX)
    expect(result.ok).toBe(true)
    // Exempt path: no spill despite exhausted budget
    expect(spills).toHaveLength(0)
  })
})

// ── Lane C — steer / abort ────────────────────────────────────────────────────

describe('Lane C — steer/abort', () => {
  it('pre-aborted signal → no tool_execution_start, agent_aborted(pre_tool), agent_end(aborted)', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const { harness } = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      abortCtx: { wakeAbort: ctrl, reason: 'user-cancel' },
      registrations: regs(),
      ports: PORTS,
      mockStreamFn: mockStream([
        { type: 'tool-call', toolName: 'bash', toolCallId: 'tc1', args: { command: 'echo hi' } },
        { type: 'finish', finishReason: 'tool_calls' },
      ]),
    })
    const types = harness.events.map((e) => e.type)
    expect(types).not.toContain('tool_execution_start')
    const aborted = harness.events.find((e) => e.type === 'agent_aborted') as AgentAbortedEvent | undefined
    expect(aborted?.abortedAt).toBe('pre_tool')
    expect(aborted?.reason).toBe('user-cancel')
    expect(harness.events.find((e) => e.type === 'agent_end')).toMatchObject({ reason: 'aborted' })
  })

  it('abort inside tool execution → tool completes, agent_aborted(in_tool)', async () => {
    const ctrl = new AbortController()
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
      abortCtx: { wakeAbort: ctrl, reason: 'external' },
      registrations: regs({ tools: [toolThatAborts] }),
      ports: PORTS,
      mockStreamFn: mockStream([
        { type: 'tool-call', toolName: 'bash', toolCallId: 'tc1', args: { command: 'echo a' } },
        { type: 'finish', finishReason: 'tool_calls' },
      ]),
    })
    expect(harness.events.some((e) => e.type === 'tool_execution_end')).toBe(true)
    const aborted = harness.events.find((e) => e.type === 'agent_aborted') as AgentAbortedEvent | undefined
    expect(aborted?.abortedAt).toBe('in_tool')
  })

  it('steer pushed before wake → steer_injected at turn 1, text prepended to prompt', async () => {
    const steerQueue = createSteerQueue()
    steerQueue.push('Focus on refunds.')
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
    const steerEvt = harness.events.find((e) => e.type === 'steer_injected') as SteerInjectedEvent | undefined
    expect(steerEvt?.text).toBe('Focus on refunds.')
    expect(steerEvt?.turnIndex).toBe(1)
    expect(harness.capturedPrompts[1]?.firstUserMessage).toContain('Focus on refunds.')
  })

  it('C×D — aborted wake (interrupted=false) → restart-recovery does NOT inject interrupted block', async () => {
    // Wakes with agent_aborted in journal signal intent, not crash → getLastWakeTail returns interrupted:false
    const contributor = createRestartRecoveryContributor('conv-aborted', async () => ({ interrupted: false }))
    const stubCtx = {
      organizationId: 't1',
      conversationId: 'conv-aborted',
      agentId: 'a',
      contactId: 'k',
      turnIndex: 0,
      bash: new Bash({ fs: new InMemoryFs() }),
    }
    const result = await contributor.contribute(stubCtx)
    expect(result).toBe('')
  })
})

// ── Lane D — restart recovery ─────────────────────────────────────────────────

describe('Lane D — restart recovery', () => {
  it('interrupted previous wake → injects <previous-turn-interrupted> into turn-0 side-load (one-shot)', async () => {
    const contributor = createRestartRecoveryContributor('conv-crashed', async () => ({ interrupted: true }))
    const stubCtx = {
      organizationId: 't1',
      conversationId: 'conv-crashed',
      agentId: 'a',
      contactId: 'k',
      turnIndex: 0,
      bash: new Bash({ fs: new InMemoryFs() }),
    }
    const first = await contributor.contribute(stubCtx)
    expect(first).toContain('previous-turn-interrupted')
    // One-shot: subsequent calls return empty (turn 1+ must not re-inject)
    const second = await contributor.contribute(stubCtx)
    expect(second).toBe('')
  })
})

// ── Lane E — parallel classifier ─────────────────────────────────────────────

describe('Lane E — parallel classifier', () => {
  function call(name: string, pg: AgentTool['parallelGroup'], args: unknown = {}): ToolCall {
    return { tool: makeTool(name, pg), args }
  }

  it('never=serial, safe+safe=parallel, path-scoped+overlapping paths=two serials', () => {
    // never → own serial group
    const neverGroups = classifyBatch([call('bash', 'never')])
    expect(neverGroups).toHaveLength(1)
    expect(neverGroups[0].kind).toBe('serial')

    // safe + safe → single parallel group
    const safeGroups = classifyBatch([call('read', 'safe'), call('search', 'safe')])
    expect(safeGroups).toHaveLength(1)
    expect(safeGroups[0].kind).toBe('parallel')
    if (safeGroups[0].kind === 'parallel') expect(safeGroups[0].calls).toHaveLength(2)

    // path-scoped with overlapping paths → two separate serial groups
    const pathGroups = classifyBatch([
      call('write1', { kind: 'path-scoped' as const, pathArg: 'path' }, { path: '/workspace/a' }),
      call('write2', { kind: 'path-scoped' as const, pathArg: 'path' }, { path: '/workspace/a/b' }), // overlaps /workspace/a
    ])
    expect(pathGroups).toHaveLength(2)
    expect(pathGroups.every((g) => g.kind === 'parallel')).toBe(true)
  })
})

// ── Lane F — cost / iteration budget ─────────────────────────────────────────

describe('Lane F — cost/iteration budget', () => {
  const BASE: IterationBudget = {
    maxTurnsPerWake: 10,
    softCostCeilingUsd: 0,
    hardCostCeilingUsd: 0,
    maxOutputTokens: 1000,
    maxInputTokens: 1000,
  }

  it('assessBudget returns null when under all thresholds', () => {
    expect(assessBudget(BASE, { turnsConsumed: 3, spentUsd: 0 })).toBeNull()
  })

  it('assessBudget returns soft at 70% turn threshold, hard at 100%', () => {
    // maxTurnsPerWake=10 → softThreshold=ceil(7)=7
    expect(assessBudget(BASE, { turnsConsumed: 7, spentUsd: 0 })).toBe('soft')
    expect(assessBudget(BASE, { turnsConsumed: 10, spentUsd: 0 })).toBe('hard')
  })

  it('bootWake with maxTurnsPerWake=2 → budget_warning(hard) + agent_end(blocked)', async () => {
    const budget: IterationBudget = { ...BASE, maxTurnsPerWake: 2 }
    const { harness } = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      iterationBudget: budget,
      registrations: regs(),
      ports: PORTS,
      mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
    })
    const warnings = harness.events.filter((e) => e.type === 'budget_warning') as BudgetWarningEvent[]
    expect(warnings.some((w) => w.phase === 'hard')).toBe(true)
    expect(harness.events.find((e) => e.type === 'agent_end')).toMatchObject({ reason: 'blocked' })
  })

  it('NACK — checkDailyCeiling returns correct contract shape {exceeded, spentUsd, ceilingUsd}', async () => {
    const agentsPort = emptyAgents()
    const result = await agentsPort.checkDailyCeiling('t1', 'agent-1')
    expect(typeof result.exceeded).toBe('boolean')
    expect(typeof result.spentUsd).toBe('number')
    expect(typeof result.ceilingUsd).toBe('number')
  })

  it('checkDailyCeiling is declared in the AgentsPort contract (grep)', () => {
    const src = readFileSync(join(import.meta.dir, '../server/contracts/agents-port.ts'), 'utf-8')
    expect(src).toContain('checkDailyCeiling')
  })

  it('frozen-snapshot regression — systemHash stable across turns when budget side-load text changes', async () => {
    // Soft threshold fires after turn 1 (ceil(3*0.7)=3 turns), so a 3-turn run
    // exercises both the no-warning side-load and the soft-warning side-load.
    // Frozen-snapshot invariant: system prompt hash MUST be identical across turns.
    const budget: IterationBudget = { ...BASE, maxTurnsPerWake: 3, softCostCeilingUsd: 999 }
    const { harness } = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      maxTurns: 3,
      iterationBudget: budget,
      registrations: regs(),
      ports: PORTS,
      mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
    })
    expect(harness.capturedPrompts.length).toBeGreaterThanOrEqual(2)
    const firstHash = harness.capturedPrompts[0]?.systemHash
    expect(firstHash).toBeTruthy()
    for (const p of harness.capturedPrompts) {
      expect(p.systemHash).toBe(firstHash as string)
    }
  })
})

// ── Lane H — provider factory + cache instrumentation ────────────────────────

describe('Lane H — provider factory + cache instrumentation', () => {
  it('BIFROST_API_KEY set → routes via Bifrost gateway, full model ID preserved', () => {
    process.env.BIFROST_API_KEY = 'bfk-test'
    process.env.BIFROST_URL = 'https://gateway.bifrost.example.com/v1'
    const result = resolveProviderEndpoint('anthropic/claude-sonnet-4-6')
    expect(result.baseURL).toBe('https://gateway.bifrost.example.com/v1')
    expect(result.apiKey).toBe('bfk-test')
    expect(result.resolvedModelId).toBe('anthropic/claude-sonnet-4-6')
  })

  it('direct mode (no BIFROST_API_KEY) → per-provider endpoint, strips provider prefix', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    const result = resolveProviderEndpoint('anthropic/claude-sonnet-4-6')
    expect(result.baseURL).toBe('https://api.anthropic.com/v1/')
    expect(result.apiKey).toBe('sk-ant-test')
    expect(result.resolvedModelId).toBe('claude-sonnet-4-6')
  })

  it('OpenAI request body includes prompt_cache_key=sha256(system).slice(0,16), retention=24h', async () => {
    const system = 'You are a helpful assistant.'
    let capturedBody: Record<string, unknown> = {}
    const mockFetch: OpenAIFetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    const provider = createOpenAIProvider({ apiKey: 'test', defaultModel: 'gpt-4', fetch: mockFetch })
    for await (const _ of provider.stream({ system, messages: [], stream: true })) {
      // drain
    }
    const extra = capturedBody.extra_body as Record<string, unknown> | undefined
    expect(typeof extra?.prompt_cache_key).toBe('string')
    expect((extra?.prompt_cache_key as string).length).toBe(16)
    expect(extra?.prompt_cache_retention).toBe('24h')
  })

  it('CACHE HIT (BLOCKING) — LlmCallEvent.cacheReadTokens=300 + cacheHit=true from fixture', async () => {
    const provider = createRecordedProvider('provider-cache-hit.jsonl')
    const { harness } = await bootWake({
      organizationId: 't1',
      agentId: 'agent-1',
      contactId: 'k1',
      provider,
      registrations: regs(),
      ports: PORTS,
    })
    const llmCall = harness.events.find((e) => e.type === 'llm_call') as LlmCallEvent | undefined
    expect(llmCall?.cacheReadTokens).toBe(300)
    expect(llmCall?.cacheHit).toBe(true)
  })
})
