/**
 * Live-smoke — exercises real Anthropic + OpenAI provider adapters end-to-end.
 *
 * Opt-in only. Runs when ALL are true:
 *   - USE_RECORDED_FIXTURES=false
 *   - The relevant provider API key is present in env
 *
 * The assertions are contract-level (stream produced events, finish chunk has
 * cost + token counts), not fixture-level — live providers are non-deterministic
 * in text output and tool-call IDs, so token counts and exact ordering are not
 * asserted. This suite exists to catch "the adapter doesn't work at all"
 * regressions, not drift in model behavior.
 */
import { describe, expect, it } from 'bun:test'
import type { LlmProvider } from '@server/contracts/provider-port'
import { createAnthropicProvider, createOpenAIProvider } from '@server/harness/providers'

const LIVE = process.env.USE_RECORDED_FIXTURES === 'false'
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const OPENAI_KEY = process.env.OPENAI_API_KEY

const SYSTEM_PROMPT =
  'You are a concise assistant. When the user asks for the capital of a country, respond with just the city name.'
const USER_MESSAGE = 'What is the capital of France?'

async function drainStream(provider: LlmProvider): Promise<{
  textChunks: string[]
  toolUseStartCount: number
  finish:
    | {
        finishReason: string
        tokensIn: number
        tokensOut: number
        costUsd: number
        latencyMs: number
      }
    | undefined
}> {
  const textChunks: string[] = []
  let toolUseStartCount = 0
  let finish: Awaited<ReturnType<typeof drainStream>>['finish']

  const iter = provider.stream({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: USER_MESSAGE }],
  })
  for await (const chunk of iter) {
    if (chunk.type === 'text-delta') textChunks.push(chunk.text)
    else if (chunk.type === 'tool-use-start') toolUseStartCount++
    else if (chunk.type === 'finish') {
      finish = {
        finishReason: chunk.finishReason,
        tokensIn: chunk.tokensIn,
        tokensOut: chunk.tokensOut,
        costUsd: chunk.costUsd,
        latencyMs: chunk.latencyMs,
      }
    }
  }
  return { textChunks, toolUseStartCount, finish }
}

describe.skipIf(!LIVE)('live-smoke — provider adapters against real APIs', () => {
  it.skipIf(!ANTHROPIC_KEY)(
    'Anthropic streams a reply with non-zero tokens + cost',
    async () => {
      const provider = createAnthropicProvider({
        apiKey: ANTHROPIC_KEY!,
        defaultModel: process.env.ANTHROPIC_DEFAULT_MODEL ?? 'claude-sonnet-4-6',
      })
      const out = await drainStream(provider)
      expect(out.textChunks.length).toBeGreaterThan(0)
      expect(out.textChunks.join('')).toMatch(/paris/i)
      expect(out.finish).toBeDefined()
      expect(out.finish?.finishReason).not.toBe('error')
      expect(out.finish?.tokensIn ?? 0).toBeGreaterThan(0)
      expect(out.finish?.tokensOut ?? 0).toBeGreaterThan(0)
      expect(out.finish?.costUsd ?? 0).toBeGreaterThan(0)
      expect(out.finish?.latencyMs ?? 0).toBeGreaterThan(0)
    },
    60_000,
  )

  it.skipIf(!OPENAI_KEY)(
    'OpenAI streams a reply with non-zero tokens + cost',
    async () => {
      const provider = createOpenAIProvider({
        apiKey: OPENAI_KEY!,
        defaultModel: process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-5.4',
      })
      const out = await drainStream(provider)
      expect(out.textChunks.length).toBeGreaterThan(0)
      expect(out.textChunks.join('')).toMatch(/paris/i)
      expect(out.finish).toBeDefined()
      expect(out.finish?.finishReason).not.toBe('error')
      expect(out.finish?.tokensIn ?? 0).toBeGreaterThan(0)
      expect(out.finish?.tokensOut ?? 0).toBeGreaterThan(0)
      expect(out.finish?.costUsd ?? 0).toBeGreaterThan(0)
      expect(out.finish?.latencyMs ?? 0).toBeGreaterThan(0)
    },
    60_000,
  )

  it.skipIf(!ANTHROPIC_KEY)(
    'Anthropic picks send_card when given card-friendly prompt + tool',
    async () => {
      const provider = createAnthropicProvider({
        apiKey: ANTHROPIC_KEY!,
        defaultModel: process.env.ANTHROPIC_DEFAULT_MODEL ?? 'claude-sonnet-4-6',
      })
      const iter = provider.stream({
        system:
          'Prefer send_card for any reply containing options, prices, or choices. Reserve plain reply for pure acknowledgements.',
        messages: [{ role: 'user', content: 'What are your pricing plans?' }],
        tools: [
          {
            name: 'send_card',
            description: 'Send a rich card with fields and CTA buttons. Preferred for structured replies.',
            inputSchema: {
              type: 'object',
              properties: {
                type: { type: 'string', const: 'card' },
                title: { type: 'string' },
                children: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string' },
                      content: { type: 'string' },
                    },
                    required: ['type'],
                  },
                },
              },
              required: ['type', 'children'],
            },
            async execute() {
              return { ok: true as const, content: { messageId: 'smoke' } }
            },
          },
          {
            name: 'reply',
            description: 'Send plain text.',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
            async execute() {
              return { ok: true as const, content: { messageId: 'smoke' } }
            },
          },
        ],
      })
      const toolNames: string[] = []
      let finishReason = ''
      for await (const chunk of iter) {
        if (chunk.type === 'tool-use-start') toolNames.push(chunk.toolName)
        if (chunk.type === 'finish') finishReason = chunk.finishReason
      }
      expect(finishReason).not.toBe('error')
      // Assert the strengthened prompt + tool description biases the model
      // toward send_card. Text-only reply is a drift signal.
      expect(toolNames).toContain('send_card')
    },
    60_000,
  )

  it.skipIf(!OPENAI_KEY)(
    'OpenAI picks send_card when given card-friendly prompt + tool',
    async () => {
      const provider = createOpenAIProvider({
        apiKey: OPENAI_KEY!,
        defaultModel: process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-5.4',
      })
      const iter = provider.stream({
        system:
          'Prefer send_card for any reply containing options, prices, or choices. Reserve plain reply for pure acknowledgements.',
        messages: [{ role: 'user', content: 'What are your pricing plans?' }],
        tools: [
          {
            name: 'send_card',
            description: 'Send a rich card with fields and CTA buttons. Preferred for structured replies.',
            inputSchema: {
              type: 'object',
              properties: {
                type: { type: 'string', const: 'card' },
                title: { type: 'string' },
                children: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string' },
                      content: { type: 'string' },
                    },
                    required: ['type'],
                  },
                },
              },
              required: ['type', 'children'],
            },
            async execute() {
              return { ok: true as const, content: { messageId: 'smoke' } }
            },
          },
          {
            name: 'reply',
            description: 'Send plain text.',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
            async execute() {
              return { ok: true as const, content: { messageId: 'smoke' } }
            },
          },
        ],
      })
      const toolNames: string[] = []
      let finishReason = ''
      for await (const chunk of iter) {
        if (chunk.type === 'tool-use-start') toolNames.push(chunk.toolName)
        if (chunk.type === 'finish') finishReason = chunk.finishReason
      }
      expect(finishReason).not.toBe('error')
      expect(toolNames).toContain('send_card')
    },
    60_000,
  )
})
