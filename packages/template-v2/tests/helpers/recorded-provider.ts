/**
 * Recorded-fixture LlmProvider — replays Anthropic SSE events stored in JSONL files.
 *
 * Each line of the fixture file is a raw Anthropic SSE data-event JSON object
 * (the same shape returned by `translateAnthropicEvent`). The recorded provider
 * feeds these through the same translation function as the real Anthropic adapter so
 * the harness exercises the full stream-parsing code path without making live API calls.
 *
 * Usage:
 *   const provider = createRecordedProvider('meridian-hi-reply.jsonl')
 *   await bootWake({ provider, ... })
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LlmFinish, LlmProvider, LlmStreamChunk } from '@server/contracts/provider-port'
import { createAnthropicProvider, translateAnthropicEvent } from '@server/harness/providers/anthropic'

const FIXTURES_DIR = join(import.meta.dir, '../fixtures/provider')

/**
 * When `USE_RECORDED_FIXTURES === 'false'`, return the live Anthropic provider instead of
 * replaying the fixture. Used by the nightly workflow to detect drift between the
 * recorded `.jsonl` and the real API. `ANTHROPIC_API_KEY` must be set.
 */
export function createRecordedProvider(fixtureName: string): LlmProvider {
  if (process.env.USE_RECORDED_FIXTURES === 'false') {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('USE_RECORDED_FIXTURES=false but ANTHROPIC_API_KEY is not set')
    }
    return createAnthropicProvider({
      apiKey,
      defaultModel: process.env.ANTHROPIC_DEFAULT_MODEL ?? 'claude-sonnet-4-6',
    })
  }
  const fixturePath = fixtureName.includes('/') ? fixtureName : join(FIXTURES_DIR, fixtureName)
  return {
    name: 'anthropic',
    stream(_request): AsyncIterableIterator<LlmStreamChunk> {
      return replayFixture(fixturePath)
    },
  }
}

async function* replayFixture(fixturePath: string): AsyncIterableIterator<LlmStreamChunk> {
  const content = readFileSync(fixturePath, 'utf-8')
  const lines = content.split('\n').filter((l) => l.trim().length > 0)

  const toolBlocks = new Map<number, { toolCallId: string; toolName: string }>()
  const usage: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  } = {}
  let finishReason: LlmFinish['finishReason'] = 'end_turn'

  for (const line of lines) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const chunks = translateAnthropicEvent(
      parsed,
      toolBlocks,
      (u) => Object.assign(usage, u),
      (r) => {
        finishReason = r
      },
    )
    for (const c of chunks) yield c
  }

  const tokensIn = usage.input_tokens ?? 0
  const tokensOut = usage.output_tokens ?? 0
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0
  const inputPrice = 3
  const outputPrice = 15
  const cacheReadPrice = 0.3
  const cacheWritePrice = 3.75

  yield {
    type: 'finish',
    finishReason,
    tokensIn,
    tokensOut,
    cacheReadTokens,
    costUsd:
      (tokensIn * inputPrice) / 1_000_000 +
      (tokensOut * outputPrice) / 1_000_000 +
      (cacheReadTokens * cacheReadPrice) / 1_000_000 +
      (cacheWriteTokens * cacheWritePrice) / 1_000_000,
    latencyMs: 50,
    cacheHit: cacheReadTokens > 0,
  }
}
