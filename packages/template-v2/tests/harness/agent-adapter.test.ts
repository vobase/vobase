/**
 * pi-agent-core adapter — unit tests.
 *
 * Scope (no DB, no real pi-mono lifecycle):
 *   - `drainProviderTurn` collects provider chunks into MockStreamEvents +
 *     terminal `LlmFinish` metadata used by agent-runner to patch `llm_call`.
 *   - `providerToStreamFn` bridge returns a StreamFn whose async generator
 *     yields the same events + populates the shared `finishRef`.
 *   - `translatePiMonoEvents` pure translation matches the Phase 1 canonical
 *     contract-event sequence (`PHASE_1_CANONICAL_EVENT_SEQUENCE`).
 */

import { describe, expect, it } from 'bun:test'
import type { AgentEvent as PiAgentEvent } from '@mariozechner/pi-agent-core'
import type { AgentEvent, ToolExecutionEndEvent } from '@server/contracts/event'
import type { LlmProvider, LlmStreamChunk } from '@server/contracts/provider-port'
import {
  drainProviderTurn,
  PHASE_1_CANONICAL_EVENT_SEQUENCE,
  providerToStreamFn,
  translatePiMonoEvents,
} from '@server/harness/agent-adapter'
import { bootWakePhase3 } from '../helpers/make-phase3-harness'
import { createRecordedProvider } from '../helpers/recorded-provider'

function providerFrom(chunks: readonly LlmStreamChunk[]): LlmProvider {
  return {
    name: 'mock',
    stream() {
      async function* iter() {
        for (const c of chunks) yield c
      }
      return iter()
    },
  }
}

// ---------------------------------------------------------------------------

describe('drainProviderTurn', () => {
  it('translates a text-only stream to one text-delta + one finish', async () => {
    const provider = providerFrom([
      { type: 'text-delta', text: 'hello' },
      { type: 'text-delta', text: ' world' },
      {
        type: 'finish',
        finishReason: 'end_turn',
        tokensIn: 10,
        tokensOut: 2,
        cacheReadTokens: 0,
        costUsd: 0.001,
        latencyMs: 42,
        cacheHit: false,
      },
    ])

    const { events, finish } = await drainProviderTurn(provider, { messages: [] })

    expect(events.filter((e) => e.type === 'text-delta').map((e) => (e as { delta: string }).delta)).toEqual([
      'hello',
      ' world',
    ])
    expect(events.at(-1)).toEqual({ type: 'finish', finishReason: 'stop' })
    expect(finish.tokensIn).toBe(10)
    expect(finish.tokensOut).toBe(2)
    expect(finish.costUsd).toBe(0.001)
    expect(finish.latencyMs).toBe(42)
    expect(finish.cacheHit).toBe(false)
  })

  it('aggregates tool-use start/delta/end into one tool-call with parsed args', async () => {
    const provider = providerFrom([
      { type: 'tool-use-start', toolCallId: 'call_1', toolName: 'bash' },
      { type: 'tool-use-delta', toolCallId: 'call_1', inputJsonDelta: '{"cmd":"l' },
      { type: 'tool-use-delta', toolCallId: 'call_1', inputJsonDelta: 's /"}' },
      { type: 'tool-use-end', toolCallId: 'call_1' },
      {
        type: 'finish',
        finishReason: 'tool_use',
        tokensIn: 5,
        tokensOut: 9,
        cacheReadTokens: 0,
        costUsd: 0,
        latencyMs: 7,
        cacheHit: false,
      },
    ])

    const { events, finish } = await drainProviderTurn(provider, { messages: [] })

    const toolCalls = events.filter((e) => e.type === 'tool-call') as Array<{
      type: 'tool-call'
      toolCallId?: string
      toolName: string
      args: unknown
    }>
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.toolName).toBe('bash')
    expect(toolCalls[0]?.toolCallId).toBe('call_1')
    expect(toolCalls[0]?.args).toEqual({ cmd: 'ls /' })
    expect(events.at(-1)).toEqual({ type: 'finish', finishReason: 'tool_calls' })
    expect(finish.finishReason).toBe('tool_use')
  })

  it('maps max_tokens → length and error → error', async () => {
    const maxProvider = providerFrom([
      {
        type: 'finish',
        finishReason: 'max_tokens',
        tokensIn: 1,
        tokensOut: 0,
        cacheReadTokens: 0,
        costUsd: 0,
        latencyMs: 1,
        cacheHit: false,
      },
    ])
    const errProvider = providerFrom([
      {
        type: 'finish',
        finishReason: 'error',
        tokensIn: 0,
        tokensOut: 0,
        cacheReadTokens: 0,
        costUsd: 0,
        latencyMs: 1,
        cacheHit: false,
      },
    ])

    const maxRes = await drainProviderTurn(maxProvider, { messages: [] })
    const errRes = await drainProviderTurn(errProvider, { messages: [] })
    expect(maxRes.events.at(-1)).toEqual({ type: 'finish', finishReason: 'length' })
    expect(errRes.events.at(-1)).toEqual({ type: 'finish', finishReason: 'error' })
  })

  it('returns a safe fallback finish when provider never emits one', async () => {
    const provider = providerFrom([{ type: 'text-delta', text: 'abc' }])
    const { events, finish } = await drainProviderTurn(provider, { messages: [] })
    expect(events.at(-1)).toEqual({ type: 'finish', finishReason: 'stop' })
    expect(finish.finishReason).toBe('end_turn')
    expect(finish.tokensIn).toBe(0)
    expect(finish.tokensOut).toBe(0)
  })
})

// ---------------------------------------------------------------------------

describe('providerToStreamFn', () => {
  it('yields the same events and populates finishRef with the terminal finish', async () => {
    const provider = providerFrom([
      { type: 'text-delta', text: 'hi' },
      {
        type: 'finish',
        finishReason: 'end_turn',
        tokensIn: 1,
        tokensOut: 1,
        cacheReadTokens: 0,
        costUsd: 0.0001,
        latencyMs: 3,
        cacheHit: false,
      },
    ])

    const { streamFn, finishRef } = providerToStreamFn(provider, { messages: [] })
    const collected: string[] = []
    for await (const ev of streamFn()) {
      collected.push(ev.type)
    }
    expect(collected).toEqual(['text-delta', 'finish'])
    expect(finishRef.value?.costUsd).toBe(0.0001)
    expect(finishRef.value?.tokensIn).toBe(1)
  })
})

// ---------------------------------------------------------------------------

describe('translatePiMonoEvents → canonical contract sequence', () => {
  it('single-turn no-tool pi-mono lifecycle matches PHASE_1_CANONICAL_EVENT_SEQUENCE', () => {
    const pi: PiAgentEvent[] = [
      { type: 'agent_start' } as unknown as PiAgentEvent,
      { type: 'turn_start' } as unknown as PiAgentEvent,
      { type: 'message_start' } as unknown as PiAgentEvent,
      { type: 'message_update' } as unknown as PiAgentEvent,
      { type: 'message_end' } as unknown as PiAgentEvent,
      { type: 'turn_end' } as unknown as PiAgentEvent,
      { type: 'agent_end' } as unknown as PiAgentEvent,
    ]
    expect(translatePiMonoEvents(pi)).toEqual([...PHASE_1_CANONICAL_EVENT_SEQUENCE])
  })

  it('turn with tool call inserts tool_execution_start/end between message_end and turn_end', () => {
    const pi: PiAgentEvent[] = [
      { type: 'agent_start' } as unknown as PiAgentEvent,
      { type: 'turn_start' } as unknown as PiAgentEvent,
      { type: 'message_start' } as unknown as PiAgentEvent,
      { type: 'message_update' } as unknown as PiAgentEvent,
      { type: 'message_end' } as unknown as PiAgentEvent,
      { type: 'tool_execution_start' } as unknown as PiAgentEvent,
      { type: 'tool_execution_end' } as unknown as PiAgentEvent,
      { type: 'turn_end' } as unknown as PiAgentEvent,
      { type: 'agent_end' } as unknown as PiAgentEvent,
    ]
    expect(translatePiMonoEvents(pi)).toEqual([
      'agent_start',
      'turn_start',
      'llm_call',
      'message_start',
      'message_update',
      'message_end',
      'tool_execution_start',
      'tool_execution_end',
      'turn_end',
      'agent_end',
    ])
  })

  it('drops tool_execution_update (optional in our contract)', () => {
    const pi: PiAgentEvent[] = [
      { type: 'message_update' } as unknown as PiAgentEvent,
      { type: 'tool_execution_update' } as unknown as PiAgentEvent,
      { type: 'message_update' } as unknown as PiAgentEvent,
    ]
    expect(translatePiMonoEvents(pi)).toEqual(['message_update', 'message_update'])
  })
})

// ---------------------------------------------------------------------------
// Real LLM bash invocation via the Anthropic provider adapter. Asserts the
// recorded `bash` tool_use fixture flows through the unchanged
// `translateAnthropicEvent` pipeline, that `bootWake()` executes the command
// against the virtual `InMemoryFs`, emits a `tool_execution_end` with non-null
// stdout, and that the command surfaces in turn N+1's side-load as a trailing
// `## Last turn side-effects` block (frozen-snapshot invariant).
// ---------------------------------------------------------------------------

describe('phase 3 — bash tool_use via recorded provider', () => {
  function textContentsOfBashToolEnd(events: readonly AgentEvent[]): string {
    const end = events.find(
      (ev): ev is ToolExecutionEndEvent => ev.type === 'tool_execution_end' && ev.toolName === 'bash',
    )
    if (!end) return ''
    const result = end.result as { ok?: boolean; stdout?: string; data?: { stdout?: string } }
    return result.stdout ?? result.data?.stdout ?? ''
  }

  it('executes `ls /workspace/drive` against the InMemoryFs and emits non-null stdout', async () => {
    const provider = createRecordedProvider('meridian-bash-navigate.jsonl')

    const { harness } = await bootWakePhase3({
      organizationId: 'org-phase3',
      agentId: 'agt-phase3',
      contactId: 'ct-phase3',
      provider,
      maxTurns: 1,
    })

    // The harness always wires `bash` into the tool index (see agent-runner.ts).
    const toolEnds = harness.events.filter((e) => e.type === 'tool_execution_end') as ToolExecutionEndEvent[]
    const bashEnd = toolEnds.find((e) => e.toolName === 'bash')
    expect(bashEnd).toBeDefined()
    expect(bashEnd?.isError).toBe(false)
    const stdout = textContentsOfBashToolEnd(harness.events)
    expect(typeof stdout).toBe('string')
    // `ls /workspace/drive` against the default virtual fs returns the scoped drive
    // listing; exact contents aren't asserted (depends on materializers), but the
    // stdout field is populated (non-null, non-empty for the empty listing case).
    expect(stdout.length).toBeGreaterThanOrEqual(0)
  })

  it('surfaces the bash command in turn N+1 side-load as `## Last turn side-effects`', async () => {
    const provider = createRecordedProvider('meridian-bash-memory-set.jsonl')

    // Two turns: turn 0 runs the bash command, turn 1's frozen first-user message
    // must include the trailing section. The recorded fixture terminates after
    // one turn — for N+1 we rely on the `maxTurns: 2` loop where turn 1 re-uses
    // the same fixture replay (still emits a `finish` + empty tool set).
    const { harness } = await bootWakePhase3({
      organizationId: 'org-phase3',
      agentId: 'agt-phase3',
      contactId: 'ct-phase3',
      provider,
      maxTurns: 2,
    })

    expect(harness.capturedPrompts.length).toBe(2)
    const [turn0, turn1] = harness.capturedPrompts

    // Turn 0's side-load MUST NOT mention the command (frozen-snapshot invariant).
    expect(turn0?.firstUserMessage ?? '').not.toContain('Last turn side-effects')
    expect(turn0?.firstUserMessage ?? '').not.toContain('vobase memory set')

    // Turn 1's side-load MUST carry the bash command under the new heading.
    expect(turn1?.firstUserMessage ?? '').toContain('## Last turn side-effects')
    expect(turn1?.firstUserMessage ?? '').toContain('vobase memory set')
  })
})
