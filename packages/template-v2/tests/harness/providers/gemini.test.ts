/**
 * Gemini provider — unit tests mirroring anthropic.test.ts.
 *
 * Mocks `fetch` via cfg.fetch injection — no network traffic.
 * Asserts:
 *   - request body shape (systemInstruction, contents, tools, generationConfig)
 *   - SSE translation (text-delta, tool-use start/delta/end, finish)
 *   - cost accounting fields populate on finish chunk
 *   - finish reason mapping (STOP -> end_turn, MAX_TOKENS -> max_tokens, etc.)
 *   - error path yields a terminal finish with finishReason: 'error'
 */

import { describe, expect, it } from 'bun:test'
import type { LlmRequest } from '@server/contracts/plugin-context'
import type { LlmFinish, LlmStreamChunk } from '@server/contracts/provider-port'
import { buildGeminiRequestBody, createGeminiProvider, type GeminiFetch } from '@server/harness/providers/gemini'
import { translateGeminiEvent } from '@server/harness/providers/translate-gemini-event'

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

describe('Gemini provider — request shape', () => {
  it('buildGeminiRequestBody forwards systemInstruction, contents, tools, generationConfig', () => {
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
    const body = buildGeminiRequestBody({
      apiKey: 'k',
      model: 'gemini-2.0-flash',
      request,
      fetch: globalThis.fetch as GeminiFetch,
      baseUrl: '',
      maxTokens: 1024,
      inputPrice: 0,
      outputPrice: 0,
    })

    expect(body.systemInstruction).toEqual({ parts: [{ text: 'you are helpful' }] })
    const contents = body.contents as Array<{ role: string; parts: Array<{ text: string }> }>
    expect(contents[0]).toEqual({ role: 'user', parts: [{ text: 'hi' }] })
    const tools = body.tools as [{ functionDeclarations: Array<{ name: string; description: string }> }]
    expect(tools[0].functionDeclarations[0].name).toBe('bash')
    expect(tools[0].functionDeclarations[0].description).toBe('run a bash command')
    expect((body.generationConfig as { maxOutputTokens: number }).maxOutputTokens).toBe(1024)
  })

  it('maps assistant role to model', () => {
    const request: LlmRequest = { messages: [{ role: 'assistant', content: 'ok' }] }
    const body = buildGeminiRequestBody({
      apiKey: 'k',
      model: 'm',
      request,
      fetch: globalThis.fetch as GeminiFetch,
      baseUrl: '',
      maxTokens: 100,
      inputPrice: 0,
      outputPrice: 0,
    })
    const contents = body.contents as Array<{ role: string }>
    expect(contents[0].role).toBe('model')
  })

  it('omits systemInstruction when system is absent', () => {
    const request: LlmRequest = { messages: [{ role: 'user', content: 'hi' }] }
    const body = buildGeminiRequestBody({
      apiKey: 'k',
      model: 'm',
      request,
      fetch: globalThis.fetch as GeminiFetch,
      baseUrl: '',
      maxTokens: 100,
      inputPrice: 0,
      outputPrice: 0,
    })
    expect(body.systemInstruction).toBeUndefined()
  })

  it('omits tools when request.tools is empty', () => {
    const request: LlmRequest = { messages: [{ role: 'user', content: 'hi' }], tools: [] }
    const body = buildGeminiRequestBody({
      apiKey: 'k',
      model: 'm',
      request,
      fetch: globalThis.fetch as GeminiFetch,
      baseUrl: '',
      maxTokens: 100,
      inputPrice: 0,
      outputPrice: 0,
    })
    expect(body.tools).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------

describe('Gemini provider — stream parsing', () => {
  it('yields text-delta chunks from text parts', async () => {
    const events = [
      {
        candidates: [{ content: { parts: [{ text: 'Hello ' }], role: 'model' } }],
        usageMetadata: { promptTokenCount: 10 },
      },
      {
        candidates: [{ content: { parts: [{ text: 'world!' }], role: 'model' }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      },
    ]
    const mockFetch: GeminiFetch = async () => okResponse(sseBody(events))
    const provider = createGeminiProvider({
      apiKey: 'test-key',
      defaultModel: 'gemini-2.0-flash',
      fetch: mockFetch,
    })
    const chunks = await drainStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    const textChunks = chunks.filter((c) => c.type === 'text-delta')
    expect(textChunks).toHaveLength(2)
    expect((textChunks[0] as { type: 'text-delta'; text: string }).text).toBe('Hello ')
    expect((textChunks[1] as { type: 'text-delta'; text: string }).text).toBe('world!')
  })

  it('populates cost accounting fields on finish chunk', async () => {
    const events = [
      {
        candidates: [{ content: { parts: [{ text: 'hi' }], role: 'model' }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      },
    ]
    const mockFetch: GeminiFetch = async () => okResponse(sseBody(events))
    const provider = createGeminiProvider({
      apiKey: 'test-key',
      defaultModel: 'gemini-2.0-flash',
      fetch: mockFetch,
      inputPricePerMTok: 1,
      outputPricePerMTok: 2,
    })
    const chunks = await drainStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    const finish = chunks.find((c) => c.type === 'finish') as LlmFinish | undefined
    expect(finish).toBeDefined()
    expect(finish?.tokensIn).toBe(100)
    expect(finish?.tokensOut).toBe(50)
    expect(finish?.costUsd).toBeCloseTo((100 * 1 + 50 * 2) / 1_000_000)
    expect(finish?.finishReason).toBe('end_turn')
    expect(finish?.cacheReadTokens).toBe(0)
    expect(finish?.cacheHit).toBe(false)
  })

  it('emits tool-use-start + delta + end for functionCall parts', async () => {
    const events = [
      {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'bash', args: { cmd: 'ls' } } }],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
      },
    ]
    const mockFetch: GeminiFetch = async () => okResponse(sseBody(events))
    const provider = createGeminiProvider({ apiKey: 'k', defaultModel: 'm', fetch: mockFetch })
    const chunks = await drainStream(provider.stream({ messages: [{ role: 'user', content: 'run ls' }] }))
    const types = chunks.map((c) => c.type).filter((t) => t !== 'finish')
    expect(types).toEqual(['tool-use-start', 'tool-use-delta', 'tool-use-end'])
  })

  it('maps MAX_TOKENS finish reason', async () => {
    const events = [
      {
        candidates: [{ content: { parts: [{ text: 'truncated' }], role: 'model' }, finishReason: 'MAX_TOKENS' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4096 },
      },
    ]
    const mockFetch: GeminiFetch = async () => okResponse(sseBody(events))
    const provider = createGeminiProvider({ apiKey: 'k', defaultModel: 'm', fetch: mockFetch })
    const chunks = await drainStream(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    const finish = chunks.find((c) => c.type === 'finish') as LlmFinish | undefined
    expect(finish?.finishReason).toBe('max_tokens')
  })

  it('yields error finish on network failure', async () => {
    const mockFetch: GeminiFetch = async () => {
      throw new Error('network error')
    }
    const provider = createGeminiProvider({ apiKey: 'k', defaultModel: 'm', fetch: mockFetch })
    const chunks = await drainStream(provider.stream({ messages: [] }))
    const finish = chunks.find((c) => c.type === 'finish') as LlmFinish | undefined
    expect(finish?.finishReason).toBe('error')
    expect(finish?.tokensIn).toBe(0)
    expect(finish?.costUsd).toBe(0)
  })

  it('yields error finish on non-ok response', async () => {
    const mockFetch: GeminiFetch = async () => new Response('bad request', { status: 400 })
    const provider = createGeminiProvider({ apiKey: 'k', defaultModel: 'm', fetch: mockFetch })
    const chunks = await drainStream(provider.stream({ messages: [] }))
    const finish = chunks.find((c) => c.type === 'finish') as LlmFinish | undefined
    expect(finish?.finishReason).toBe('error')
  })
})

// ---------------------------------------------------------------------------

describe('translateGeminiEvent', () => {
  it('maps STOP -> end_turn', () => {
    let reason: string | undefined
    translateGeminiEvent(
      { candidates: [{ finishReason: 'STOP' }] },
      { toolCallCounter: 0 },
      () => {},
      (r) => {
        reason = r
      },
    )
    expect(reason).toBe('end_turn')
  })

  it('maps MAX_TOKENS -> max_tokens', () => {
    let reason: string | undefined
    translateGeminiEvent(
      { candidates: [{ finishReason: 'MAX_TOKENS' }] },
      { toolCallCounter: 0 },
      () => {},
      (r) => {
        reason = r
      },
    )
    expect(reason).toBe('max_tokens')
  })

  it('maps TOOL_CALLS -> tool_use', () => {
    let reason: string | undefined
    translateGeminiEvent(
      { candidates: [{ finishReason: 'TOOL_CALLS' }] },
      { toolCallCounter: 0 },
      () => {},
      (r) => {
        reason = r
      },
    )
    expect(reason).toBe('tool_use')
  })

  it('captures usage metadata', () => {
    let captured: { promptTokenCount?: number; candidatesTokenCount?: number } = {}
    translateGeminiEvent(
      { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 }, candidates: [] },
      { toolCallCounter: 0 },
      (u) => {
        captured = u
      },
      () => {},
    )
    expect(captured.promptTokenCount).toBe(100)
    expect(captured.candidatesTokenCount).toBe(50)
  })

  it('uses incrementing counter for deterministic tool call IDs', () => {
    const state = { toolCallCounter: 0 }
    const chunks1 = translateGeminiEvent(
      { candidates: [{ content: { parts: [{ functionCall: { name: 'a', args: {} } }] } }] },
      state,
      () => {},
      () => {},
    )
    const chunks2 = translateGeminiEvent(
      { candidates: [{ content: { parts: [{ functionCall: { name: 'b', args: {} } }] } }] },
      state,
      () => {},
      () => {},
    )
    const id1 = (chunks1[0] as { toolCallId: string }).toolCallId
    const id2 = (chunks2[0] as { toolCallId: string }).toolCallId
    expect(id1).toBe('gemini-1')
    expect(id2).toBe('gemini-2')
  })
})
