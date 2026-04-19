import { afterEach, describe, expect, it } from 'bun:test'
import type { LlmFinish } from '@server/contracts/provider-port'
import { createRecordedProvider } from '../../../tests/helpers/recorded-provider'
import { _clearEndpointCache, resolveProviderEndpoint } from './factory'
import { createOpenAIProvider, type OpenAIFetch } from './openai'

afterEach(() => {
  _clearEndpointCache()
  delete process.env.BIFROST_API_KEY
  delete process.env.BIFROST_URL
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.OPENAI_API_KEY
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
})

describe('providers/factory', () => {
  it('factory routes via Bifrost when BIFROST_API_KEY set', () => {
    process.env.BIFROST_API_KEY = 'bfk-test'
    process.env.BIFROST_URL = 'https://gateway.bifrost.example.com/v1'

    const result = resolveProviderEndpoint('anthropic/claude-sonnet-4-6')

    expect(result.baseURL).toBe('https://gateway.bifrost.example.com/v1')
    expect(result.apiKey).toBe('bfk-test')
    // Bifrost routes by provider prefix — full model ID must be preserved.
    expect(result.resolvedModelId).toBe('anthropic/claude-sonnet-4-6')
  })

  it('factory uses per-provider OpenAI-compat endpoint when BIFROST_API_KEY unset', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'

    const result = resolveProviderEndpoint('anthropic/claude-sonnet-4-6')

    expect(result.baseURL).toBe('https://api.anthropic.com/v1/')
    expect(result.apiKey).toBe('sk-ant-test')
    // Direct access: provider prefix stripped so upstream API receives a bare model name.
    expect(result.resolvedModelId).toBe('claude-sonnet-4-6')
  })

  it('OpenAI request includes prompt_cache_key as sha256(system).slice(0,16)', async () => {
    const system = 'You are a helpful assistant.'
    let capturedBody: Record<string, unknown> = {}

    const mockFetch: OpenAIFetch = async (_url, init) => {
      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>
      // Return a minimal SSE stream that ends cleanly.
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }

    const provider = createOpenAIProvider({ apiKey: 'test', defaultModel: 'gpt-4', fetch: mockFetch })
    // Drain the stream (we only need the request capture; finish chunk is irrelevant).
    for await (const _ of provider.stream({ system, messages: [], stream: true })) {
      // drain
    }

    const extraBody = capturedBody.extra_body as Record<string, unknown> | undefined
    expect(extraBody).toBeDefined()
    expect(typeof extraBody?.prompt_cache_key).toBe('string')
    expect((extraBody?.prompt_cache_key as string).length).toBe(16)
    expect(extraBody?.prompt_cache_retention).toBe('24h')
  })

  it('LlmCallEvent.cacheReadTokens populated from usage.prompt_tokens_details.cached_tokens', async () => {
    // The fixture has cache_read_input_tokens: 300 out of input_tokens: 1000 (30%).
    const provider = createRecordedProvider('provider-cache-hit.jsonl')
    const chunks: Array<{ type: string; cacheReadTokens?: number }> = []

    for await (const chunk of provider.stream({ model: 'test', messages: [] })) {
      chunks.push(chunk as { type: string; cacheReadTokens?: number })
    }

    const finish = chunks.find((c) => c.type === 'finish') as LlmFinish | undefined
    expect(finish?.cacheReadTokens).toBe(300)
    expect(finish?.cacheHit).toBe(true)
  })
})
