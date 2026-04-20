/**
 * Gemini nightly drift detection — step 3 in template-v2-nightly.yml.
 *
 * Runs only when GOOGLE_API_KEY is set (live nightly; skipped in standard CI).
 * Sends a caption-style prompt through createGeminiProvider and asserts the
 * event sequence is structurally consistent with meridian-caption-image.jsonl.
 *
 * "Drift" means the API started returning unexpected event types or stopped
 * terminating with a finish chunk — not that the exact text changed.
 */

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { LlmFinish, LlmStreamChunk } from '@server/contracts/provider-port'
import { createGeminiProvider } from '@server/harness/providers/gemini'

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? ''

function loadFixtureEventTypes(filename: string): string[] {
  const lines = readFileSync(`tests/fixtures/provider/${filename}`, 'utf8').split('\n').filter(Boolean)
  const types: string[] = []
  for (const line of lines) {
    const ev = JSON.parse(line) as {
      candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> }; finishReason?: string }>
    }
    const candidate = ev.candidates?.[0]
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (typeof part.text === 'string') types.push('text-delta')
        if (part.functionCall) types.push('tool-use')
      }
    }
    if (candidate?.finishReason) types.push('finish')
  }
  return types
}

describe.if(GOOGLE_API_KEY !== '')('Gemini nightly — live API drift detection', () => {
  it('caption stream produces text-delta + finish matching meridian-caption-image.jsonl structure', async () => {
    const provider = createGeminiProvider({
      apiKey: GOOGLE_API_KEY,
      defaultModel: 'gemini-2.0-flash',
    })

    const chunks: LlmStreamChunk[] = []
    for await (const chunk of provider.stream({
      messages: [
        {
          role: 'user',
          content:
            'Describe this image for a customer-service AI agent to know when to share it and what to say about it.',
        },
      ],
    })) {
      chunks.push(chunk)
    }

    // Must always terminate with a finish chunk.
    const finish = chunks.at(-1) as LlmFinish | undefined
    expect(finish?.type).toBe('finish')
    expect(finish?.finishReason).not.toBe('error')

    // Must produce at least one text-delta (caption response is always text).
    const textChunks = chunks.filter((c) => c.type === 'text-delta')
    expect(textChunks.length).toBeGreaterThan(0)

    // Fixture must also produce text + finish — structural drift fails here.
    const fixtureTypes = loadFixtureEventTypes('meridian-caption-image.jsonl')
    expect(fixtureTypes).toContain('text-delta')
    expect(fixtureTypes).toContain('finish')

    // Both live and fixture must agree that no tool-use events appear for
    // a plain-text caption response.
    const liveTypes = chunks.map((c) => c.type)
    const liveHasTools = liveTypes.some((t) => t === 'tool-use-start')
    const fixtureHasTools = fixtureTypes.some((t) => t === 'tool-use')
    expect(liveHasTools).toBe(fixtureHasTools)
  }, 60_000)
})
