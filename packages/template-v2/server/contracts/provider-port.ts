/**
 * LlmProvider contract — plan §P2.0, §P2.1.
 *
 * Unifies Anthropic / OpenAI / Gemini streamFn signatures behind one interface.
 * Phase 2 critical path: Anthropic only. OpenAI + Gemini are stretch unit-tests.
 *
 * The harness consumes LlmProvider via `server/runtime/llm-call.ts`; individual
 * provider adapters live in `server/harness/providers/`.
 */

import type { LlmRequest } from './plugin-context'

// ─── Stream chunks ──────────────────────────────────────────────────────────

export type LlmTextDelta = {
  type: 'text-delta'
  text: string
}

export type LlmToolUseStart = {
  type: 'tool-use-start'
  toolCallId: string
  toolName: string
}

export type LlmToolUseDelta = {
  type: 'tool-use-delta'
  toolCallId: string
  /** Partial JSON fragment for the tool's input args. */
  inputJsonDelta: string
}

export type LlmToolUseEnd = {
  type: 'tool-use-end'
  toolCallId: string
}

export type LlmFinish = {
  type: 'finish'
  finishReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | string
  tokensIn: number
  tokensOut: number
  /** Cache-read tokens (Anthropic extended thinking / prompt cache). */
  cacheReadTokens: number
  /** Estimated USD cost from the provider's billing metadata. */
  costUsd: number
  latencyMs: number
  cacheHit: boolean
}

export type LlmStreamChunk = LlmTextDelta | LlmToolUseStart | LlmToolUseDelta | LlmToolUseEnd | LlmFinish

// ─── Provider interface ─────────────────────────────────────────────────────

/**
 * Pluggable LLM provider. Adapters implement this interface; the harness selects
 * one via `pickProvider(config)` in `server/harness/providers/index.ts`.
 */
export interface LlmProvider {
  readonly name: string
  /**
   * Initiate a streaming LLM call. Returns an async iterable of typed chunks.
   * The caller must consume the iterable to completion to ensure cost accounting.
   * Never throws — errors surface as a terminal `finish` chunk with `finishReason: 'error'`.
   */
  stream(request: LlmRequest): AsyncIterableIterator<LlmStreamChunk>
}
