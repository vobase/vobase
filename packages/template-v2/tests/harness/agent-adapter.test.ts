/**
 * pi-agent-core adapter — unit tests for P2.1 critical path.
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
import type { LlmProvider, LlmStreamChunk } from '@server/contracts/provider-port'
import {
  drainProviderTurn,
  PHASE_1_CANONICAL_EVENT_SEQUENCE,
  providerToStreamFn,
  translatePiMonoEvents,
} from '@server/harness/agent-adapter'

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
