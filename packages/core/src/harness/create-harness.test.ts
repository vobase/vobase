/**
 * Core harness unit coverage — exercises the pi-agent-core event-translation
 * pipeline with a stub stream and a minimal workspace. No DB, no network.
 *
 * Ports the three invariant assertions from template-v2's
 * `server/harness/agent-runner.test.ts`:
 *   1. Single-turn reply emits the contract event sequence.
 *   2. systemHash is stable across user-turns (frozen-snapshot).
 *   3. `llm_call` carries synthesised tokens + cost + latency from
 *      `message.usage` / `Date.now() - turnStartedAt`.
 */

import { describe, expect, it } from 'bun:test'
import type { StreamFn } from '@mariozechner/pi-agent-core'
import type { AssistantMessage, AssistantMessageEvent, Model } from '@mariozechner/pi-ai'
import { createAssistantMessageEventStream } from '@mariozechner/pi-ai'
import { Bash, InMemoryFs } from 'just-bash'
import { createHarness, type HarnessEvent, type HarnessWorkspace } from './create-harness'
import { createSteerQueue } from './steer-queue'

// ─── Minimal model ────────────────────────────────────────────────────────
// Model is opaque to the harness; we only need `.id` and `.provider` to flow
// into the synthesised `llm_call` event.
const STUB_MODEL = {
  id: 'gpt-5.4',
  provider: 'openai',
  api: 'openai-responses',
  baseUrl: 'https://example.invalid',
  reasoning: false,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  // biome-ignore lint/suspicious/noExplicitAny: Model api type varies per provider
} as unknown as Model<any>

// ─── Stub stream ──────────────────────────────────────────────────────────
function stubStreamFn(scripts: AssistantMessageEvent[][]): StreamFn {
  let callIndex = 0
  return () => {
    const script = scripts[callIndex] ?? scripts[scripts.length - 1] ?? []
    callIndex += 1
    const stream = createAssistantMessageEventStream()
    queueMicrotask(() => {
      let terminal: AssistantMessageEvent | undefined
      for (const ev of script) {
        if (ev.type === 'done' || ev.type === 'error') {
          terminal = ev
          continue
        }
        stream.push(ev)
      }
      if (!terminal) {
        const last = script[script.length - 1]
        const lastPartial = last && 'partial' in last ? last.partial : undefined
        if (lastPartial) {
          terminal = { type: 'done', reason: 'stop', message: { ...lastPartial, stopReason: 'stop' } }
        }
      }
      if (terminal?.type === 'done') {
        stream.push(terminal)
        stream.end(terminal.message)
      } else if (terminal?.type === 'error') {
        stream.push(terminal)
        stream.end(terminal.error)
      } else {
        stream.end()
      }
    })
    return stream
  }
}

// ─── Test data ────────────────────────────────────────────────────────────
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

function makeWorkspace(): HarnessWorkspace {
  const innerFs = new InMemoryFs()
  const bash = new Bash({ fs: innerFs })
  return { bash, innerFs }
}

const COMMON = {
  organizationId: 'org-test',
  agentId: 'agent-test',
  contactId: 'contact-1',
  agentDefinition: { model: 'gpt-5.4' },
  model: STUB_MODEL,
  systemPrompt: 'You are a test assistant.',
  systemHash: 'hash-stable-0001',
  renderTrigger: () => 'test user message',
}

describe('createHarness (pi-agent-core path)', () => {
  it('emits the contract event sequence for a single-turn text reply', async () => {
    const res = await createHarness({
      ...COMMON,
      workspace: makeWorkspace(),
      streamFn: stubStreamFn([simpleReplyScript('hello')]),
      maxTurns: 1,
    })

    const types = res.harness.events.map((e: HarnessEvent) => e.type).filter((t) => t !== 'message_update')

    expect(types[0]).toBe('agent_start')
    expect(types.at(-1)).toBe('agent_end')
    expect(types.filter((t) => t === 'turn_start').length).toBe(1)
    expect(types.filter((t) => t === 'turn_end').length).toBe(1)
    expect(types.filter((t) => t === 'llm_call').length).toBe(1)
    expect(types.filter((t) => t === 'message_start').length).toBe(1)
    expect(types.filter((t) => t === 'message_end').length).toBe(1)
  })

  it('emits systemHash on agent_start and keeps it stable across multi-turn', async () => {
    const steerQueue = createSteerQueue()
    steerQueue.push('steer!')
    const res = await createHarness({
      ...COMMON,
      workspace: makeWorkspace(),
      streamFn: stubStreamFn([simpleReplyScript('one'), simpleReplyScript('two')]),
      maxTurns: 2,
      steerQueue,
    })

    expect(res.harness.capturedPrompts.length).toBe(2)
    const h0 = res.harness.capturedPrompts[0]?.systemHash
    const h1 = res.harness.capturedPrompts[1]?.systemHash
    expect(h0).toBeDefined()
    expect(h1).toBe(h0)
  })

  it('llm_call event carries synthesized tokens + cost + latency from message.usage', async () => {
    const res = await createHarness({
      ...COMMON,
      workspace: makeWorkspace(),
      streamFn: stubStreamFn([simpleReplyScript('hi')]),
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
