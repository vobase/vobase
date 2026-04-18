/**
 * Anthropic provider — unit tests for P2.1 critical path.
 *
 * Mocks `fetch` via `cfg.fetch` injection so no network traffic occurs.
 * Asserts:
 *   - request body shape (model, messages, system, tools, stream, max_tokens)
 *   - SSE translation (text-delta, tool-use start/delta/end, finish)
 *   - cost accounting populated from usage (tokensIn/Out/cacheRead/costUsd)
 *   - cacheHit toggles when cache_read_input_tokens > 0
 *   - error path yields a terminal `finish` with `finishReason: 'error'`
 */

import { describe, expect, it } from 'bun:test'
import type { LlmRequest } from '@server/contracts/plugin-context'
import type { LlmFinish, LlmStreamChunk } from '@server/contracts/provider-port'
import {
  type AnthropicFetch,
  buildAnthropicRequestBody,
  createAnthropicProvider,
  translateAnthropicEvent,
} from '@server/harness/providers/anthropic'

function sseBody(events: readonly object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`))
      }
      controller.close()
    },
  })
}

function okResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

async function drainStream(stream: AsyncIterableIterator<LlmStreamChunk>): Promise<LlmStreamChunk[]> {
  const out: LlmStreamChunk[] = []
  for await (const c of stream) out.push(c)
  return out
}

// ---------------------------------------------------------------------------

describe('Anthropic provider — request shape', () => {
  it('buildAnthropicRequestBody forwards model/messages/system/tools/max_tokens with stream=true', () => {
    const request: LlmRequest = {
      system: 'you are helpful',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'bash',
          description: 'run a bash command',
          inputSchema: { type: 'object', properties: { cmd: { type: 'string' } } },
          execute: async () => ({ ok: true, content: 'ok' }),
        },
      ],
    }
    const body = buildAnthropicRequestBody({
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
      request,
      fetch: (() => {
        throw new Error('should not call')
      }) as AnthropicFetch,
      baseUrl: 'https://api.anthropic.com',
      maxTokens: 4096,
      anthropicVersion: '2023-06-01',
      inputPrice: 3,
      outputPrice: 15,
      cacheReadPrice: 0.3,
      cacheWritePrice: 3.75,
    })

    expect(body).toMatchObject({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
      system: 'you are helpful',
    })
    expect(Array.isArray(body.tools)).toBe(true)
    const tools = body.tools as Array<{ name: string; description: string; input_schema: unknown }>
    expect(tools[0]).toMatchObject({
      name: 'bash',
      description: 'run a bash command',
    })
    expect(tools[0]?.input_schema).toMatchObject({ type: 'object' })
  })

  it('provider.stream() sends POST /v1/messages with headers + JSON body', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const mockFetch: AnthropicFetch = async (url, init) => {
      capturedUrl = url
      capturedInit = init
      return okResponse(
        sseBody([{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } }]),
      )
    }

    const provider = createAnthropicProvider({
      apiKey: 'sk-ant-test',
      defaultModel: 'claude-sonnet-4-6',
      fetch: mockFetch,
    })
    await drainStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))

    expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages')
    const headers = capturedInit?.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['content-type']).toBe('application/json')
    const parsed = JSON.parse(String(capturedInit?.body))
    expect(parsed.model).toBe('claude-sonnet-4-6')
    expect(parsed.stream).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('Anthropic provider — streaming translation', () => {
  it('translates a text-only turn: message_start → block_start(text) → delta → block_stop → message_delta(end_turn) → message_stop', async () => {
    const mockFetch: AnthropicFetch = async () =>
      okResponse(
        sseBody([
          { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 2 },
          },
          { type: 'message_stop' },
        ]),
      )

    const provider = createAnthropicProvider({
      apiKey: 'k',
      defaultModel: 'claude-sonnet-4-6',
      fetch: mockFetch,
    })
    const chunks = await drainStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))

    const textDeltas = chunks.filter((c) => c.type === 'text-delta')
    expect(textDeltas.map((c) => (c as { text: string }).text)).toEqual(['Hello', ' world'])

    const finish = chunks.at(-1) as LlmFinish
    expect(finish.type).toBe('finish')
    expect(finish.finishReason).toBe('end_turn')
    expect(finish.tokensIn).toBe(10)
    expect(finish.tokensOut).toBe(2)
  })

  it('translates a tool-use turn: block_start(tool_use) → input_json_delta → block_stop → tool_use finishReason', async () => {
    const mockFetch: AnthropicFetch = async () =>
      okResponse(
        sseBody([
          { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 0 } } },
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'toolu_01', name: 'bash' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"cmd":"l' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: 's /"}' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use' },
            usage: { output_tokens: 9 },
          },
          { type: 'message_stop' },
        ]),
      )

    const provider = createAnthropicProvider({
      apiKey: 'k',
      defaultModel: 'claude-sonnet-4-6',
      fetch: mockFetch,
    })
    const chunks = await drainStream(provider.stream({ messages: [{ role: 'user', content: 'ls' }] }))

    const starts = chunks.filter((c) => c.type === 'tool-use-start') as Array<{
      type: 'tool-use-start'
      toolCallId: string
      toolName: string
    }>
    expect(starts).toEqual([{ type: 'tool-use-start', toolCallId: 'toolu_01', toolName: 'bash' }])

    const deltas = chunks.filter((c) => c.type === 'tool-use-delta') as Array<{
      type: 'tool-use-delta'
      inputJsonDelta: string
    }>
    expect(deltas.map((d) => d.inputJsonDelta).join('')).toBe('{"cmd":"ls /"}')

    const ends = chunks.filter((c) => c.type === 'tool-use-end')
    expect(ends).toHaveLength(1)

    const finish = chunks.at(-1) as LlmFinish
    expect(finish.finishReason).toBe('tool_use')
  })
})

// ---------------------------------------------------------------------------

describe('Anthropic provider — cost accounting', () => {
  it('computes costUsd from tokens × per-M pricing and flips cacheHit when cache_read > 0', async () => {
    const mockFetch: AnthropicFetch = async () =>
      okResponse(
        sseBody([
          {
            type: 'message_start',
            message: {
              usage: {
                input_tokens: 1_000_000,
                output_tokens: 0,
                cache_read_input_tokens: 2_000_000,
                cache_creation_input_tokens: 500_000,
              },
            },
          },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 500_000 },
          },
          { type: 'message_stop' },
        ]),
      )

    const provider = createAnthropicProvider({
      apiKey: 'k',
      defaultModel: 'claude-sonnet-4-6',
      fetch: mockFetch,
    })
    const chunks = await drainStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    const finish = chunks.at(-1) as LlmFinish

    // 1M input × $3 + 500k output × $15 + 2M cache-read × $0.3 + 500k cache-write × $3.75
    // = 3 + 7.5 + 0.6 + 1.875 = 12.975
    expect(finish.costUsd).toBeCloseTo(12.975, 5)
    expect(finish.cacheHit).toBe(true)
    expect(finish.tokensIn).toBe(1_000_000)
    expect(finish.tokensOut).toBe(500_000)
    expect(finish.cacheReadTokens).toBe(2_000_000)
    expect(finish.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('cacheHit=false when no cache_read_input_tokens', async () => {
    const mockFetch: AnthropicFetch = async () =>
      okResponse(
        sseBody([
          { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 5 },
          },
          { type: 'message_stop' },
        ]),
      )
    const provider = createAnthropicProvider({
      apiKey: 'k',
      defaultModel: 'claude-sonnet-4-6',
      fetch: mockFetch,
    })
    const chunks = await drainStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    const finish = chunks.at(-1) as LlmFinish
    expect(finish.cacheHit).toBe(false)
    expect(finish.cacheReadTokens).toBe(0)
  })
})

// ---------------------------------------------------------------------------

describe('Anthropic provider — error path', () => {
  it('yields terminal finish{finishReason:"error"} when fetch rejects', async () => {
    const mockFetch: AnthropicFetch = async () => {
      throw new Error('network down')
    }
    const provider = createAnthropicProvider({
      apiKey: 'k',
      defaultModel: 'claude-sonnet-4-6',
      fetch: mockFetch,
    })
    const chunks = await drainStream(provider.stream({ messages: [{ role: 'user', content: 'x' }] }))
    expect(chunks).toHaveLength(1)
    const finish = chunks[0] as LlmFinish
    expect(finish.type).toBe('finish')
    expect(finish.finishReason).toBe('error')
    expect(finish.tokensIn).toBe(0)
    expect(finish.tokensOut).toBe(0)
  })

  it('yields terminal finish{finishReason:"error"} when response.ok is false', async () => {
    const mockFetch: AnthropicFetch = async () =>
      new Response('oops', { status: 500, headers: { 'content-type': 'text/plain' } })
    const provider = createAnthropicProvider({
      apiKey: 'k',
      defaultModel: 'claude-sonnet-4-6',
      fetch: mockFetch,
    })
    const chunks = await drainStream(provider.stream({ messages: [{ role: 'user', content: 'x' }] }))
    expect(chunks).toHaveLength(1)
    const finish = chunks[0] as LlmFinish
    expect(finish.finishReason).toBe('error')
  })
})

// ---------------------------------------------------------------------------

describe('translateAnthropicEvent — unit', () => {
  it('ignores unknown event types', () => {
    const out = translateAnthropicEvent(
      { type: 'ping' },
      new Map(),
      () => undefined,
      () => undefined,
    )
    expect(out).toEqual([])
  })

  it('captures usage from message_start but emits no chunks', () => {
    let seen: unknown
    const out = translateAnthropicEvent(
      { type: 'message_start', message: { usage: { input_tokens: 42 } } },
      new Map(),
      (u) => {
        seen = u
      },
      () => undefined,
    )
    expect(out).toEqual([])
    expect((seen as { input_tokens: number }).input_tokens).toBe(42)
  })

  it('maps stop_reason=end_turn → end_turn on message_delta', () => {
    let stop = 'unset'
    translateAnthropicEvent(
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      new Map(),
      () => undefined,
      (r) => {
        stop = r
      },
    )
    expect(stop).toBe('end_turn')
  })
})
