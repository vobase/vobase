/**
 * Core harness unit coverage — exercises the pi-agent-core event-translation
 * pipeline with a stub stream and a minimal workspace. No DB, no network.
 *
 * Ports the three invariant assertions from the template's
 * `server/harness/agent-runner.test.ts`:
 *   1. Single-turn reply emits the contract event sequence.
 *   2. systemHash is stable across user-turns (frozen-snapshot).
 *   3. `llm_call` carries synthesised tokens + cost + latency from
 *      `message.usage` / `Date.now() - turnStartedAt`.
 */

import { describe, expect, it } from 'bun:test'
import type { AgentMessage, StreamFn } from '@mariozechner/pi-agent-core'
import type { AssistantMessage, AssistantMessageEvent, ImageContent, Model } from '@mariozechner/pi-ai'
import { createAssistantMessageEventStream } from '@mariozechner/pi-ai'
import { Bash, InMemoryFs } from 'just-bash'

import { DirtyTracker } from '../workspace/dirty-tracker'
import { createHarness, type HarnessEvent, type HarnessWorkspace } from './create-harness'
import { createSteerQueue } from './steer-queue'
import type { WakeRuntime } from './types'

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

function makeRuntime(workspace: HarnessWorkspace): WakeRuntime {
  return { fs: workspace.innerFs, tracker: new DirtyTracker(new Map(), [], []) }
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
    const workspace = makeWorkspace()
    const res = await createHarness({
      ...COMMON,
      workspace,
      runtime: makeRuntime(workspace),
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
    const workspace = makeWorkspace()
    const res = await createHarness({
      ...COMMON,
      workspace,
      runtime: makeRuntime(workspace),
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
    const workspace = makeWorkspace()
    const res = await createHarness({
      ...COMMON,
      workspace,
      runtime: makeRuntime(workspace),
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

  it('passes the provided runtime as second argument to on_event listeners', async () => {
    const workspace = makeWorkspace()
    const runtime = makeRuntime(workspace)
    const seen: Array<{ type: string; runtime: WakeRuntime }> = []
    const res = await createHarness({
      ...COMMON,
      workspace,
      runtime,
      streamFn: stubStreamFn([simpleReplyScript('hi')]),
      maxTurns: 1,
      hooks: {
        on_event: [
          (ev, rt) => {
            seen.push({ type: ev.type, runtime: rt })
          },
        ],
      },
    })

    expect(res.harness.events.length).toBeGreaterThan(0)
    expect(seen.length).toBe(res.harness.events.length)
    for (const entry of seen) {
      expect(entry.runtime).toBe(runtime)
      expect(entry.runtime.fs).toBe(workspace.innerFs)
    }
  })

  it('transformContext prepends the side-load to the current user message instead of replacing it', async () => {
    // Regression: pi-ai stores user content as an array of parts, so the old
    // `typeof last.content === 'string'` check always failed and the side-load
    // *substituted* the message. The agent then lost every fresh user message
    // and answered the previous turn (the operator-thread off-by-one bug).
    const workspace = makeWorkspace()
    const captured: { messages: AgentMessage[] } = { messages: [] }
    const baseStream = stubStreamFn([simpleReplyScript('ok')])
    const streamFn: StreamFn = (model, context, options) => {
      captured.messages = context.messages
      return baseStream(model, context, options)
    }

    await createHarness({
      ...COMMON,
      renderTrigger: () => 'CURRENT-USER-MESSAGE',
      workspace,
      runtime: makeRuntime(workspace),
      streamFn,
      maxTurns: 1,
      loadMessageHistory: () =>
        Promise.resolve([
          { role: 'user', content: [{ type: 'text', text: 'OLD-USER-MESSAGE' }], timestamp: 1 },
          makeAssistantPartial('old-reply'),
        ]),
      sideLoadContributors: [
        () => Promise.resolve([{ kind: 'custom', priority: 100, render: () => 'SIDE-LOAD-MARKER' }]),
      ],
    })

    const last = captured.messages.at(-1)
    expect(last?.role).toBe('user')
    const serialized = JSON.stringify(last?.content)
    // The current user message must survive transformContext...
    expect(serialized).toContain('CURRENT-USER-MESSAGE')
    // ...with the side-load prepended, not substituted for it.
    expect(serialized).toContain('SIDE-LOAD-MARKER')
  })

  it('attaches renderTriggerImages only on the first user turn (t === 0), not on steer turns', async () => {
    // Regression lock for the inbound-image gating: the trigger image must ride
    // the first user turn exactly once and never re-attach onto a steer turn
    // (that would replay the photo's bytes and churn the provider prefix cache).
    const steerQueue = createSteerQueue()
    steerQueue.push('steer!')
    const workspace = makeWorkspace()
    let imageCalls = 0
    // Snapshot the *current* user message (last in the list) at call time —
    // context.messages is a live reference that pi mutates across turns, so it
    // must be serialized in the moment, not read post-hoc.
    const turnUserContent: string[] = []
    const baseStream = stubStreamFn([simpleReplyScript('one'), simpleReplyScript('two')])
    const streamFn: StreamFn = (model, context, options) => {
      turnUserContent.push(JSON.stringify(context.messages.at(-1)?.content))
      return baseStream(model, context, options)
    }

    const res = await createHarness({
      ...COMMON,
      workspace,
      runtime: makeRuntime(workspace),
      streamFn,
      maxTurns: 2,
      steerQueue,
      renderTriggerImages: (): ImageContent[] => {
        imageCalls += 1
        return [{ type: 'image', data: 'YmFzZTY0', mimeType: 'image/png' }]
      },
    })

    // Two turns ran (the steer drained), but the resolver fired exactly once and
    // the image content block rode only the first user turn (t === 0).
    expect(res.harness.capturedPrompts.length).toBe(2)
    expect(imageCalls).toBe(1)
    expect(turnUserContent[0]).toContain('"type":"image"')
    expect(turnUserContent[1] ?? '').not.toContain('"type":"image"')
  })
})
